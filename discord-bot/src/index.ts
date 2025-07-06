import { Client, GatewayIntentBits, Events, Message, Interaction, TextChannel, EmbedBuilder, MessageFlags } from 'discord.js';
import { WebSocketServer, WebSocket } from 'ws';
import { URLSearchParams } from 'url';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const WEBSOCKET_PORT = parseInt(process.env.WEBSOCKET_PORT || '8080');
const PUBLIC_CHANNEL_ID = process.env.PUBLIC_CHANNEL_ID;
const PRIVATE_CHANNEL_ID = process.env.PRIVATE_CHANNEL_ID;

if (!DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN is required in environment variables');
    process.exit(1);
}

if (!PUBLIC_CHANNEL_ID || !PRIVATE_CHANNEL_ID) {
    console.error('❌ PUBLIC_CHANNEL_ID and PRIVATE_CHANNEL_ID must be defined in environment variables');
    process.exit(1);
}

const ALLOWED_CHANNELS = [PUBLIC_CHANNEL_ID, PRIVATE_CHANNEL_ID];

// Discord client setup
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// WebSocket server setup
const wss = new WebSocketServer({ port: WEBSOCKET_PORT });

// Store connected WebSocket clients
const connectedClients = new Map<string, WebSocket>();
const messageQueue: any[] = [];

// Store context and pending actions per channel
const lastMessageContexts = new Map<string, Message | Interaction>();
const pendingActions = new Map<string, { type: 'command'; content: string }>();


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
                return { content: `🛠️ Using a tool...` };
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
                    // Note: We don't have channel context here, so we'll store it globally for now.
                    // A better approach would be to have the extension send the channelId back with the event.
                    // For now, we assume one pending action across all channels.
                    pendingActions.set('global', { type: 'command', content: message.text });
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
            return { content: null };
        
        case 'taskCreated':
            return { content: null }; // Remove noisy task created message
        
        case 'taskAborted':
            return { content: `❌ A previous task was aborted.` };
        
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

// WebSocket server event handlers
wss.on('connection', (ws: WebSocket, req) => {
    const params = new URLSearchParams(req.url?.split('?')[1] || '');
    const clientId = params.get('clientId');

    if (!clientId) {
        console.log('🔌 Connection rejected: No client ID provided.');
        ws.close();
        return;
    }

    // If this client ID is already connected, close the old connection
    if (connectedClients.has(clientId)) {
        console.log(`🔌 Client ${clientId} reconnected, closing old connection.`);
        connectedClients.get(clientId)?.terminate();
    }

    console.log(`🔌 New WebSocket connection established for client: ${clientId}`);
    connectedClients.set(clientId, ws);
    (ws as any).clientId = clientId;

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
            const { channelId, eventName, data: eventData } = message;
            const taskId = eventData?.taskId;

            // Ensure we only process events destined for a specific channel
            if (message.type === 'event' && channelId) {
                 // Clean up timers for completed/aborted tasks
                if ((eventName === 'taskCompleted' || eventName === 'taskAborted') && taskId) {
                    if (messageProcessingTimers.has(taskId)) {
                        clearTimeout(messageProcessingTimers.get(taskId)!);
                        messageProcessingTimers.delete(taskId);
                        console.log(`🧹 Cleaned up timer for ${eventName}: ${taskId}`);
                    }
                }

                const formattedMessage = formatEventForDiscord(eventName, eventData);
                if (formattedMessage) {
                    await sendMessageToChannel(channelId, formattedMessage);
                }
            }
        } catch (error) {
            console.error('❌ Error processing WebSocket message:', error);
        }
    });
    
    ws.on('close', () => {
        const closedClientId = (ws as any).clientId;
        console.log(`🔌 WebSocket connection closed for client: ${closedClientId}`);
        if (closedClientId) {
            connectedClients.delete(closedClientId);
        }
    });
    
    ws.on('error', (error) => {
        const errorClientId = (ws as any).clientId;
        console.error(`❌ WebSocket error for client ${errorClientId}:`, error);
        if (errorClientId) {
            connectedClients.delete(errorClientId);
        }
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
    
    connectedClients.forEach((client, clientId) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        } else {
            // Remove closed connections
            console.log(`🔌 Removing stale connection for client: ${clientId}`);
            connectedClients.delete(clientId);
        }
    });
    
    console.log(`📤 Broadcasted message to ${connectedClients.size} client(s)`);
}

// Discord bot event handlers
client.once(Events.ClientReady, (readyClient) => {
    console.log(`🤖 Discord bot ready! Logged in as ${readyClient.user.tag}`);
    console.log(`🔌 WebSocket server listening on port ${WEBSOCKET_PORT}`);
    console.log(`📢 Listening for messages in channels: ${ALLOWED_CHANNELS.join(', ')}`);
});

client.on(Events.MessageCreate, (message: Message) => {
    if (message.author.bot) return;

    if (ALLOWED_CHANNELS.includes(message.channel.id)) {
        console.log(`📨 Message received from channel ${message.channel.id}: ${message.content}`);
        
        // Store context for replies
        lastMessageContexts.set(message.channel.id, message);
        
        // Broadcast to clients
        console.log('💬 Broadcasting message payload to WebSocket clients');
        broadcastToClients({
            type: 'message',
            content: message.content,
            channelId: message.channel.id
        });
    }
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand() || !interaction.channelId) return;

    if (ALLOWED_CHANNELS.includes(interaction.channelId)) {
        console.log(`⚡ Slash command received from channel ${interaction.channelId}: /${interaction.commandName}`);

        // Store context for replies
        lastMessageContexts.set(interaction.channelId, interaction);
        const pendingAction = pendingActions.get(interaction.channelId) || pendingActions.get('global');

        try {
            if (interaction.commandName === 'reset') {
                console.log(`🔄 reset command received, broadcasting reset payload`);
                broadcastToClients({
                    type: 'command',
                    command: 'reset',
                    channelId: interaction.channelId
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
                    command: 'reset',
                    channelId: interaction.channelId
                });

                // 2. Send the new message after a short delay
                // This helps ensure the reset is processed before the new task starts
                setTimeout(() => {
                    broadcastToClients({
                        type: 'message',
                        content: messageContent,
                        channelId: interaction.channelId
                    });
                }, 150);

                await interaction.reply({
                    content: `🚀 New task started with your message!`,
                    flags: [MessageFlags.Ephemeral]
                });
            } else if (interaction.commandName === 'approve') {
                if (pendingAction) {
                    console.log(`👍 Approving action in channel ${interaction.channelId}:`, pendingAction);
                    // Send a 'yes' response back to the core to confirm the action
                    broadcastToClients({
                        type: 'message',
                        content: 'yes',
                        channelId: interaction.channelId
                    });
                    pendingActions.delete(interaction.channelId);
                    pendingActions.delete('global');
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
                    console.log(`👎 Denying action in channel ${interaction.channelId}:`, pendingAction);
                     // Send a 'no' response back to the core to deny the action
                    broadcastToClients({
                        type: 'message',
                        content: 'no',
                        channelId: interaction.channelId
                    });
                    pendingActions.delete(interaction.channelId);
                    pendingActions.delete('global');
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
            } else if (interaction.commandName === 'save-to-kb') {
                const contentToSave = interaction.options.getString('content', true);
                console.log(`💾 Received content in channel ${interaction.channelId} to save to knowledge base:`, contentToSave);
                broadcastToClients({
                    type: 'command',
                    command: 'save_to_kb',
                    content: contentToSave,
                    channelId: interaction.channelId
                });
                await interaction.reply({
                    content: '✅ Your information has been sent for intelligent assimilation into the knowledge base.',
                    flags: [MessageFlags.Ephemeral]
                });
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