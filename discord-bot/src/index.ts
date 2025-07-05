import { Client, GatewayIntentBits, Events, Message, Interaction } from 'discord.js';
import { WebSocketServer, WebSocket } from 'ws';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const WEBSOCKET_PORT = parseInt(process.env.WEBSOCKET_PORT || '8080');
const TARGET_USER = process.env.TARGET_USER || '.uncle_dan';

if (!DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN is required in environment variables');
    process.exit(1);
}

// Discord client setup
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
    ]
});

// WebSocket server setup
const wss = new WebSocketServer({ port: WEBSOCKET_PORT });

// Store connected WebSocket clients
const connectedClients: Set<WebSocket> = new Set();

// Store target user for DMs
let targetUserCache: any = null;

// Function to format event messages for Discord
function formatEventForDiscord(eventName: string, data: any): string {
    switch (eventName) {
        case 'message':
            const message = data.message;
            if (message.say === 'reasoning') {
                return `🤔 **Thinking...**\n\`\`\`\n${message.reasoning || message.text || 'Processing...'}\n\`\`\``;
            } else if (message.say === 'completion_result') {
                return `✅ **Task Complete!**\n${message.text || 'Task completed successfully'}`;
            } else if (message.say === 'tool') {
                return `🛠️ **Using Tool:** \`${message.text || 'Unknown tool'}\``;
            } else if (message.say === 'text') {
                return `💬 ${message.text || ''}`;
            } else if (message.ask === 'followup') {
                let formatted = `❓ **Question:**\n${message.text || ''}`;
                if (message.choices && message.choices.length > 0) {
                    formatted += '\n\n**Choices:**';
                    message.choices.forEach((choice: any, index: number) => {
                        formatted += `\n${index + 1}. ${choice.label}`;
                    });
                }
                return formatted;
            } else if (message.ask) {
                return `❓ **Question:** ${message.text || ''}`;
            } else {
                return `📝 ${message.text || JSON.stringify(message)}`;
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

// Function to send DM to target user
async function sendDMToTargetUser(message: string): Promise<void> {
    try {
        // Use cached target user if available
        let targetUser = targetUserCache;
        
        // If not cached, try to find in Discord cache
        if (!targetUser) {
            targetUser = client.users.cache.find(u => u.username === TARGET_USER);
        }
        
        if (!targetUser) {
            console.log(`ℹ️ Target user ${TARGET_USER} not found. The user must send a DM first to be cached.`);
            return;
        }
        
        // Split message if it's too long
        const messageParts = splitMessage(message);
        
        // Send each part as a separate message
        for (const part of messageParts) {
            await targetUser.send(part);
            console.log(`📤 Sent DM to ${TARGET_USER}: ${part.substring(0, 100)}${part.length > 100 ? '...' : ''}`);
            
            // Small delay between messages to avoid rate limiting
            if (messageParts.length > 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
    } catch (error) {
        console.error(`❌ Error sending DM to ${TARGET_USER}:`, error);
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
            
            // Handle event messages from roo-lay extension
            if (message.type === 'event') {
                const formattedMessage = formatEventForDiscord(message.eventName, message.data);
                await sendDMToTargetUser(formattedMessage);
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
    console.log(`👤 Listening for DMs from user: ${TARGET_USER}`);
});

client.on(Events.MessageCreate, (message: Message) => {
    // Only process direct messages
    if (!message.guild && !message.author.bot) {
        console.log(`📨 DM received from ${message.author.username}: ${message.content}`);
        
        // Check if the message is from the target user
        if (message.author.username === TARGET_USER) {
            console.log(`✅ Message from target user ${TARGET_USER}, broadcasting to WebSocket clients`);
            
            // Cache the target user for later DM sending
            if (!targetUserCache) {
                targetUserCache = message.author;
                console.log(`👤 Cached target user ${TARGET_USER} for DM sending`);
            }
            
            // Handle regular message (slash commands are now handled via interactionCreate)
            console.log('💬 Regular message received, broadcasting message payload');
            broadcastToClients({
                type: 'message',
                content: message.content
            });
        } else {
            console.log(`ℹ️ Message from ${message.author.username} (not target user), ignoring`);
        }
    }
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    // Only handle slash commands in DMs from the target user
    if (!interaction.isChatInputCommand() || interaction.guild || interaction.user.username !== TARGET_USER) {
        return;
    }
    
    console.log(`⚡ Slash command received from ${interaction.user.username}: /${interaction.commandName}`);
    
    // Cache the target user for later DM sending
    if (!targetUserCache) {
        targetUserCache = interaction.user;
        console.log(`👤 Cached target user ${TARGET_USER} for DM sending`);
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