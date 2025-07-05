import { Client, GatewayIntentBits, Events, Message, Interaction, TextChannel } from 'discord.js';
import { WebSocketServer, WebSocket } from 'ws';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const WEBSOCKET_PORT = parseInt(process.env.WEBSOCKET_PORT || '8080');
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;
const TARGET_USER = process.env.TARGET_USER;

if (!DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN is required in environment variables');
    process.exit(1);
}

if (!TARGET_CHANNEL_ID && !TARGET_USER) {
    console.error('❌ TARGET_CHANNEL_ID or TARGET_USER must be defined in environment variables');
    process.exit(1);
}

// Discord client setup
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
    ]
});

// WebSocket server setup
const wss = new WebSocketServer({ port: WEBSOCKET_PORT });

// Store connected WebSocket clients
const connectedClients: Set<WebSocket> = new Set();

// Store the context of the last message to know where to reply
let lastMessageContext: Message | Interaction | null = null;

// Function to format event messages for Discord
function formatEventForDiscord(eventName: string, data: any): string | null {
    switch (eventName) {
        case 'message':
            const message = data.message;

            // Filter out noisy LiteLLM errors
            if (message.text && message.text.includes('Failed to fetch LiteLLM models')) {
                return null; // Returning null will prevent the message from being sent
            }

            if (message.say === 'reasoning') {
                return `🤔 **Thinking...**\n\`\`\`\n${message.reasoning || message.text || 'Processing...'}\n\`\`\``;
            } else if (message.say === 'completion_result') {
                return `✅ **Task Complete!**\n${message.text || 'Task completed successfully'}`;
            } else if (message.say === 'tool') {
                return `🛠️ **Using Tool:** \`${message.text || 'Unknown tool'}\``;
            } else if (message.say === 'text') {
                return `💬 ${message.text || ''}`;
            } else if (message.say === 'api_req_started') {
                return `⏳ **Loading...**`;
            } else if (message.ask === 'followup' || (message.ask && (message.choices || message.text?.startsWith('{')))) {
                try {
                    // Handle cases where the entire 'text' is a JSON string
                    if (message.text && message.text.trim().startsWith('{')) {
                        const parsed = JSON.parse(message.text);
                        let formatted = `❓ **Question:**\n${parsed.question || ''}`;
                        if (parsed.suggest && parsed.suggest.length > 0) {
                            formatted += '\n\n**Please choose an option:**';
                            parsed.suggest.forEach((choice: any, index: number) => {
                                formatted += `\n${index + 1}. ${choice.label || choice.answer}`;
                            });
                        }
                        return formatted;
                    }
                } catch (e) {
                    // Not a valid JSON, fall through to default handling
                }

                let formatted = `❓ **Question:**\n${message.text || ''}`;
                if (message.choices && message.choices.length > 0) {
                    formatted += '\n\n**Please choose an option:**';
                    message.choices.forEach((choice: any, index: number) => {
                        formatted += `\n${index + 1}. ${choice.label || choice.answer}`;
                    });
                }
                return formatted;
            } else if (message.ask) {
                return `❓ **Question:** ${message.text || ''}`;
            } else {
                // Fallback for unhandled message 'say' types
                if (message.text) {
                    return `📝 ${message.text}`;
                }
                // Avoid sending raw JSON if possible
                console.log("Unhandled message type, sending generic message:", message);
                return `📝 Processing update...`;
            }
        
        case 'taskCompleted':
            const usage = data.usage;
            const totalCost = usage?.totalCost || 0;
            const tokensIn = usage?.totalTokensIn || 0;
            const tokensOut = usage?.totalTokensOut || 0;
            return `📊 **Task Complete!**\nTokens: ${tokensIn} in, ${tokensOut} out\nTotal cost: $${totalCost.toFixed(6)}`;
        
        case 'taskStarted':
            return `🚀 **Task Started:** ${data.taskId}`;
        
        case 'taskCreated':
            return `📋 **Task Created:** ${data.taskId}`;
        
        case 'taskAborted':
            return `❌ **Task Aborted:** ${data.taskId}`;
        
        default:
            return `📡 **${eventName}:** ${JSON.stringify(data)}`;
    }
}

// Function to split long messages for Discord's 2000 character limit
function splitMessage(message: string, maxLength: number = 2000): string[] {
    if (message.length <= maxLength) {
        return [message];
    }
    
    const chunks: string[] = [];
    let currentChunk = '';
    
    // Split by lines first to preserve formatting
    const lines = message.split('\n');
    
    for (const line of lines) {
        if ((currentChunk + line + '\n').length > maxLength) {
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }
            
            // If a single line is too long, split it by words
            if (line.length > maxLength) {
                const words = line.split(' ');
                let wordChunk = '';
                
                for (const word of words) {
                    if ((wordChunk + word + ' ').length > maxLength) {
                        if (wordChunk.trim()) {
                            chunks.push(wordChunk.trim());
                            wordChunk = '';
                        }
                        // If a single word is too long, just add it as is
                        if (word.length > maxLength) {
                            chunks.push(word);
                        } else {
                            wordChunk = word + ' ';
                        }
                    } else {
                        wordChunk += word + ' ';
                    }
                }
                
                if (wordChunk.trim()) {
                    currentChunk = wordChunk;
                }
            } else {
                currentChunk = line + '\n';
            }
        } else {
            currentChunk += line + '\n';
        }
    }
    
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }
    
    return chunks;
}

// Function to send a message to a specific channel
async function sendMessageToChannel(channelId: string, content: string): Promise<void> {
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
            const messageParts = splitMessage(content);
            for (const part of messageParts) {
                // Cast to TextChannel after the type guard to satisfy the compiler
                await (channel as TextChannel).send(part);
                console.log(`📤 Sent message to channel #${(channel as any).name}`);
            }
        } else {
            console.error(`❌ Channel ${channelId} not found or is not a text channel.`);
        }
    } catch (error) {
        console.error(`❌ Error sending message to channel ${channelId}:`, error);
    }
}

// Function to send a DM to a specific user
async function sendDmToUser(userId: string, content: string): Promise<void> {
    try {
        const user = await client.users.fetch(userId);
        if (user) {
            const messageParts = splitMessage(content);
            for (const part of messageParts) {
                await user.send(part);
                console.log(`📤 Sent DM to user ${user.username}`);
            }
        } else {
            console.error(`❌ User ${userId} not found.`);
        }
    } catch (error) {
        console.error(`❌ Error sending DM to user ${userId}:`, error);
    }
}

// WebSocket server event handlers
wss.on('connection', (ws: WebSocket) => {
    console.log('🔌 New WebSocket connection established');
    connectedClients.add(ws);
    
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data.toString());
            console.log('📨 Received WebSocket message:', message);

            // Ignore partial message updates to prevent spam
            if (message.data?.message?.partial === true) {
                return;
            }
            
            // Handle event messages from roo-lay extension
            if (message.type === 'event' && lastMessageContext) {
                const formattedMessage = formatEventForDiscord(message.eventName, message.data);
                // Only send if the message is not filtered out (is not null)
                if (formattedMessage) {
                    if (lastMessageContext.guild && lastMessageContext.channelId) {
                        // It was a channel message
                        await sendMessageToChannel(lastMessageContext.channelId, formattedMessage);
                    } else {
                        // It was a DM
                        const userId = 'user' in lastMessageContext ? lastMessageContext.user.id : lastMessageContext.author.id;
                        await sendDmToUser(userId, formattedMessage);
                    }
                }
            }
        } catch (error) {
            console.error('❌ Error processing WebSocket message:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('🔌 WebSocket connection closed');
        connectedClients.delete(ws);
    });
    
    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
        connectedClients.delete(ws);
    });
    
    // Send welcome message to new client
    ws.send(JSON.stringify({
        type: 'connection',
        message: 'Connected to Discord bot WebSocket server',
        timestamp: new Date().toISOString()
    }));
});

// Function to broadcast message to all connected WebSocket clients
function broadcastToClients(data: any) {
    const message = JSON.stringify(data);
    
    connectedClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        } else {
            // Remove closed connections
            connectedClients.delete(client);
        }
    });
    
    console.log(`📤 Broadcasted message to ${connectedClients.size} client(s)`);
}

// Discord bot event handlers
client.once(Events.ClientReady, (readyClient) => {
    console.log(`🤖 Discord bot ready! Logged in as ${readyClient.user.tag}`);
    console.log(`🔌 WebSocket server listening on port ${WEBSOCKET_PORT}`);
    if (TARGET_CHANNEL_ID) console.log(`📢 Listening for messages in channel: ${TARGET_CHANNEL_ID}`);
    if (TARGET_USER) console.log(`👤 Listening for DMs from user: ${TARGET_USER}`);
});

client.on(Events.MessageCreate, (message: Message) => {
    if (message.author.bot) return;

    const isDirectMessage = !message.guild;
    const isTargetChannel = message.channel.id === TARGET_CHANNEL_ID;
    const userTag = `${message.author.username}#${message.author.discriminator}`;
    const isTargetUser = message.author.username === TARGET_USER || userTag === TARGET_USER;

    if (isTargetChannel || (isDirectMessage && isTargetUser)) {
        const source = isDirectMessage ? `DM from ${message.author.tag}` : `channel ${TARGET_CHANNEL_ID}`;
        console.log(`📨 Message received from ${source}: ${message.content}`);
        
        // Store context for replies
        lastMessageContext = message;
        
        // Broadcast to clients
        console.log('💬 Broadcasting message payload to WebSocket clients');
        broadcastToClients({
            type: 'message',
            content: message.content
        });
    }
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const isDirectMessage = !interaction.guild;
    const isTargetChannel = interaction.channelId === TARGET_CHANNEL_ID;
    const userTag = `${interaction.user.username}#${interaction.user.discriminator}`;
    const isTargetUser = interaction.user.username === TARGET_USER || userTag === TARGET_USER;

    if (isTargetChannel || (isDirectMessage && isTargetUser)) {
        const source = isDirectMessage ? `DM from ${interaction.user.tag}` : `channel ${TARGET_CHANNEL_ID}`;
        console.log(`⚡ Slash command received from ${source}: /${interaction.commandName}`);

        // Store context for replies
        lastMessageContext = interaction;

        try {
            if (interaction.commandName === 'reset' || interaction.commandName === 'new') {
                console.log(`🔄 ${interaction.commandName} command received, broadcasting reset payload`);
                
                // Both commands trigger a reset
                broadcastToClients({
                    type: 'command',
                    command: 'reset'
                });
                
                // Reply to the interaction
                await interaction.reply({
                    content: '✅ Task reset successfully. Ready for a new conversation!',
                    ephemeral: true
                });
            } else {
                // Unknown command
                await interaction.reply({
                    content: '❌ Unknown command.',
                    ephemeral: true
                });
            }
        } catch (error) {
            console.error('❌ Error handling slash command:', error);
            
            // Try to reply with an error message if we haven't replied yet
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ An error occurred while processing the command.',
                        ephemeral: true
                    });
                }
            } catch (replyError) {
                console.error('❌ Error sending error reply:', replyError);
            }
        }
    }
    
    try {
        if (interaction.commandName === 'reset' || interaction.commandName === 'new') {
            console.log(`🔄 ${interaction.commandName} command received, broadcasting reset payload`);
            
            // Both commands trigger a reset
            broadcastToClients({
                type: 'command',
                command: 'reset'
            });
            
            // Reply to the interaction
            await interaction.reply({
                content: '✅ Task reset successfully. Ready for a new conversation!',
                ephemeral: true
            });
        } else {
            // Unknown command
            await interaction.reply({
                content: '❌ Unknown command.',
                ephemeral: true
            });
        }
    } catch (error) {
        console.error('❌ Error handling slash command:', error);
        
        // Try to reply with an error message if we haven't replied yet
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ An error occurred while processing the command.',
                    ephemeral: true
                });
            }
        } catch (replyError) {
            console.error('❌ Error sending error reply:', replyError);
        }
    }
});

client.on(Events.Error, (error) => {
    console.error('❌ Discord client error:', error);
});

// Graceful shutdown handling
process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    
    // Close WebSocket server
    wss.close(() => {
        console.log('🔌 WebSocket server closed');
    });
    
    // Destroy Discord client
    client.destroy();
    console.log('🤖 Discord client destroyed');
    
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    
    // Close WebSocket server
    wss.close(() => {
        console.log('🔌 WebSocket server closed');
    });
    
    // Destroy Discord client
    client.destroy();
    console.log('🤖 Discord client destroyed');
    
    process.exit(0);
});

// Start the Discord bot
console.log('🚀 Starting Discord bot with WebSocket server...');
client.login(DISCORD_TOKEN);