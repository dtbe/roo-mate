import { Client, GatewayIntentBits, Events, Message, Interaction, TextChannel, EmbedBuilder, MessageFlags } from 'discord.js';
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
const messageQueue: any[] = [];

// Store the context of the last message to know where to reply
let lastMessageContext: Message | Interaction | null = null;
// Store an action that requires user approval
let pendingAction: { type: 'command'; content: string } | null = null;

// Debounce for batching related messages
const messageProcessingTimers = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_DELAY_MS = 350; // ms to wait for more messages from the same task

// Function to format event messages for Discord
function formatEventForDiscord(eventName: string, data: any): { content: string | null; embeds?: EmbedBuilder[] } {
    switch (eventName) {
        case 'message':
            const message = data.message;

            // Filter out noisy LiteLLM errors
            if (message.text && message.text.includes('Failed to fetch LiteLLM models')) {
                return { content: null };
            }

            if (message.say === 'reasoning') {
                return { content: `🤔 *${message.reasoning || message.text || 'Processing...'}*` };
            } else if (message.say === 'completion_result') {
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00) // Green
                    .setTitle('✅ Task Complete!')
                    .setDescription(message.text || 'Task completed successfully.');
                return { content: null, embeds: [embed] };
            } else if (message.say === 'tool') {
                return { content: `🛠️ **Using Tool:** \`${message.text || 'Unknown tool'}\`` };
            } else if (message.say === 'text') {
                if (message.text && message.text.trim().length > 0) {
                    return { content: message.text };
                }
                return { content: null };
            } else if (message.say === 'api_req_started') {
                return { content: null }; // Remove "Loading..." message
            } else if (message.ask === 'completion_result' || message.ask === 'tool') {
                return { content: null }; // This is an ack/internal message from the core, don't show it in Discord.
            } else if (message.ask === 'followup' || (message.ask && (message.choices || message.text?.startsWith('{')))) {
                // Check if this is a command execution request that needs approval
                const commandRegex = /^(npx|npm|git|yarn|pnpm|node|python|go|rustc|tsc|docker|kubectl|move|del|mkdir)\s/;
                if (message.text && commandRegex.test(message.text)) {
                    pendingAction = { type: 'command', content: message.text };
                    return { content: `🤖 **Action Required**\nRoo wants to run the following command. Please use \`/approve\` or \`/deny\`.\n\`\`\`sh\n${message.text}\n\`\`\`` };
                }
                
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
                        return { content: formatted };
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
                return { content: formatted };
            } else if (message.ask) {
                return { content: `❓ **Question:** ${message.text || ''}` };
            } else {
                // Fallback for unhandled message 'say' types
                if (message.text) {
                    if (message.say === 'user_feedback' || message.say === 'user_feedback_diff') {
                        return { content: null }; // Don't echo user's own message
                    }
                    return { content: message.text };
                }
                // Avoid sending raw JSON if possible
                console.log("Unhandled message type, sending generic message:", message);
                return { content: `Processing update...` };
            }
        
        case 'taskCompleted':
            return { content: null }; // Remove noisy task completed message with stats
        
        case 'taskStarted':
            return { content: `🚀 **Task Started:** ${data.taskId}` };
        
        case 'taskCreated':
            return { content: null }; // Remove noisy task created message
        
        case 'taskAborted':
            const embed = new EmbedBuilder()
                .setColor(0xFF0000) // Red
                .setTitle('❌ Task Aborted')
                .setDescription(`Task \`${data.taskId}\` was aborted.`);
            return { content: null, embeds: [embed] };
        
        default:
            return { content: `📡 **${eventName}:** ${JSON.stringify(data)}` };
    }
}

// Function to split long messages for Discord's 2000 character limit
function splitMessage(message: string, maxLength: number = 2000): string[] {
    const chunks: string[] = [];
    if (!message) {
        return chunks;
    }

    // If message is short enough, return as-is
    if (message.length <= maxLength) {
        chunks.push(message);
        return chunks;
    }

    let i = 0;
    while (i < message.length) {
        let endIndex = Math.min(i + maxLength, message.length);
        
        // If not at the end of the message, try to split at a reasonable point
        if (endIndex < message.length) {
            // Look for the last newline, space, or punctuation within the limit
            const chunk = message.substring(i, endIndex);
            const lastNewline = chunk.lastIndexOf('\n');
            const lastSpace = chunk.lastIndexOf(' ');
            const lastPunctuation = Math.max(chunk.lastIndexOf('.'), chunk.lastIndexOf('!'), chunk.lastIndexOf('?'));
            
            // Prefer newline, then punctuation, then space
            if (lastNewline > i + maxLength * 0.7) {
                endIndex = i + lastNewline + 1;
            } else if (lastPunctuation > i + maxLength * 0.7) {
                endIndex = i + lastPunctuation + 1;
            } else if (lastSpace > i + maxLength * 0.7) {
                endIndex = i + lastSpace + 1;
            }
        }
        
        chunks.push(message.substring(i, endIndex));
        i = endIndex;
    }
    return chunks;
}

// Function to send a message to a specific channel
async function sendMessageToChannel(channelId: string, messageOptions: { content: string | null; embeds?: EmbedBuilder[] }): Promise<void> {
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
            const { content, embeds } = messageOptions;

            // Don't send if both content and embeds are empty
            if (!content && (!embeds || embeds.length === 0)) {
                return;
            }

            const messagePayload: any = {};
            if (content) {
                const messageParts = splitMessage(content);
                // Send embeds only with the first part of a multi-part message
                for (let i = 0; i < messageParts.length; i++) {
                    const payload: any = { content: messageParts[i] };
                    if (i === 0 && embeds) {
                        payload.embeds = embeds;
                    }
                    await (channel as TextChannel).send(payload);
                    console.log(`📤 Sent message to channel #${(channel as any).name}`);
                }
            } else if (embeds) {
                messagePayload.embeds = embeds;
                await (channel as TextChannel).send(messagePayload);
                console.log(`📤 Sent embed to channel #${(channel as any).name}`);
            }
        } else {
            console.error(`❌ Channel ${channelId} not found or is not a text channel.`);
        }
    } catch (error) {
        console.error(`❌ Error sending message to channel ${channelId}:`, error);
    }
}

// Function to send a DM to a specific user
async function sendDmToUser(userId: string, messageOptions: { content: string | null; embeds?: EmbedBuilder[] }): Promise<void> {
    try {
        const user = await client.users.fetch(userId);
        if (user) {
            const { content, embeds } = messageOptions;

            // Don't send if both content and embeds are empty
            if (!content && (!embeds || embeds.length === 0)) {
                return;
            }

            const messagePayload: any = {};
            if (content) {
                const messageParts = splitMessage(content);
                // Send embeds only with the first part of a multi-part message
                for (let i = 0; i < messageParts.length; i++) {
                    const payload: any = { content: messageParts[i] };
                    if (i === 0 && embeds) {
                        payload.embeds = embeds;
                    }
                    await user.send(payload);
                    console.log(`📤 Sent DM to user ${user.username}`);
                }
            } else if (embeds) {
                messagePayload.embeds = embeds;
                await user.send(messagePayload);
                console.log(`📤 Sent embed to user ${user.username}`);
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

    // Send any queued messages
    if (messageQueue.length > 0) {
        console.log(`📬 Sending ${messageQueue.length} queued message(s).`);
        messageQueue.forEach(msg => {
            ws.send(JSON.stringify(msg));
        });
        // Clear the queue
        messageQueue.length = 0;
    }
    
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data.toString());
            console.log('📨 Received WebSocket message:', message);
            
            // --- Debounce Logic for Streaming Messages ---
            const taskId = message.data?.taskId;
            const isStreamingMessage = message.type === 'event' && message.eventName === 'message' &&
                                       (message.data?.message?.partial === true ||
                                        message.data?.message?.say === 'reasoning' ||
                                        message.data?.message?.say === 'text');

            if (taskId && isStreamingMessage) {
                if (messageProcessingTimers.has(taskId)) {
                    clearTimeout(messageProcessingTimers.get(taskId)!);
                }

                const timer = setTimeout(async () => {
                    messageProcessingTimers.delete(taskId);
                    // Only process the last received message for this taskId
                    if (lastMessageContext) {
                        const formattedMessage = formatEventForDiscord(message.eventName, message.data);
                        if (formattedMessage) {
                            if (lastMessageContext.guild && lastMessageContext.channelId) {
                                await sendMessageToChannel(lastMessageContext.channelId, formattedMessage);
                            } else {
                                const userId = 'user' in lastMessageContext ? lastMessageContext.user.id : lastMessageContext.author.id;
                                await sendDmToUser(userId, formattedMessage);
                            }
                        }
                    }
                }, DEBOUNCE_DELAY_MS);
                
                messageProcessingTimers.set(taskId, timer);
            } else if (message.type === 'event' && lastMessageContext) {
                // Clean up timers for completed/aborted tasks
                if ((message.eventName === 'taskCompleted' || message.eventName === 'taskAborted') && taskId) {
                    if (messageProcessingTimers.has(taskId)) {
                        clearTimeout(messageProcessingTimers.get(taskId)!);
                        messageProcessingTimers.delete(taskId);
                        console.log(`🧹 Cleaned up timer for ${message.eventName}: ${taskId}`);
                    }
                }

                // Handle all other non-streaming events immediately
                const formattedMessage = formatEventForDiscord(message.eventName, message.data);
                if (formattedMessage) {
                    if (lastMessageContext.guild && lastMessageContext.channelId) {
                        await sendMessageToChannel(lastMessageContext.channelId, formattedMessage);
                    } else {
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

    if (connectedClients.size === 0) {
        console.log('🔌 No clients connected, queueing message.');
        messageQueue.push(data);
        return;
    }
    
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
            if (interaction.commandName === 'reset') {
                console.log(`🔄 reset command received, broadcasting reset payload`);
                broadcastToClients({
                    type: 'command',
                    command: 'reset'
                });
                await interaction.reply({
                    content: '✅ Task reset successfully. Ready for a new conversation!',
                    flags: [MessageFlags.Ephemeral]
                });
            } else if (interaction.commandName === 'new') {
                const messageContent = interaction.options.getString('message', true); // Now required

                console.log(`🔄 new command received, broadcasting reset and message payload`);
                
                // 1. Reset the state
                broadcastToClients({
                    type: 'command',
                    command: 'reset'
                });

                // 2. Send the new message after a short delay
                // This helps ensure the reset is processed before the new task starts
                setTimeout(() => {
                    broadcastToClients({
                        type: 'message',
                        content: messageContent
                    });
                }, 150);

                await interaction.reply({
                    content: `🚀 New task started with your message!`,
                    flags: [MessageFlags.Ephemeral]
                });
            } else if (interaction.commandName === 'approve') {
                if (pendingAction) {
                    console.log(`👍 Approving action:`, pendingAction);
                    // Send a 'yes' response back to the core to confirm the action
                    broadcastToClients({
                        type: 'message',
                        content: 'yes'
                    });
                    pendingAction = null;
                    await interaction.reply({
                        content: '✅ Action approved and sent to Roo.',
                        flags: [MessageFlags.Ephemeral]
                    });
                } else {
                    await interaction.reply({
                        content: '🤷 No action pending approval.',
                        flags: [MessageFlags.Ephemeral]
                    });
                }
            } else if (interaction.commandName === 'deny') {
                if (pendingAction) {
                    console.log(`👎 Denying action:`, pendingAction);
                     // Send a 'no' response back to the core to deny the action
                    broadcastToClients({
                        type: 'message',
                        content: 'no'
                    });
                    pendingAction = null;
                    await interaction.reply({
                        content: '❌ Action denied.',
                        flags: [MessageFlags.Ephemeral]
                    });
                } else {
                    await interaction.reply({
                        content: '🤷 No action pending approval.',
                        flags: [MessageFlags.Ephemeral]
                    });
                }
            } else {
                // Unknown command
                await interaction.reply({
                    content: '❌ Unknown command.',
                    flags: [MessageFlags.Ephemeral]
                });
            }
        } catch (error) {
            console.error('❌ Error handling slash command:', error);
            
            // Try to reply with an error message if we haven't replied yet
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ An error occurred while processing the command.',
                        flags: [MessageFlags.Ephemeral]
                    });
                }
            } catch (replyError) {
                console.error('❌ Error sending error reply:', replyError);
            }
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