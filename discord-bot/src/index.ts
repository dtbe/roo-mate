import { Client, GatewayIntentBits, Events, Message, Interaction, TextChannel, EmbedBuilder, MessageFlags } from 'discord.js';
import { WebSocketServer, WebSocket } from 'ws';
import { URLSearchParams } from 'url';
import * as dotenv from 'dotenv';

// --- Configuration ---
dotenv.config();
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const WEBSOCKET_PORT = parseInt(process.env.WEBSOCKET_PORT || '8080');
const PUBLIC_CHANNEL_ID = process.env.PUBLIC_CHANNEL_ID;
const PRIVATE_CHANNEL_ID = process.env.PRIVATE_CHANNEL_ID;

if (!DISCORD_TOKEN || !PUBLIC_CHANNEL_ID || !PRIVATE_CHANNEL_ID) {
    console.error('❌ DISCORD_TOKEN, PUBLIC_CHANNEL_ID, and PRIVATE_CHANNEL_ID are required.');
    process.exit(1);
}
const ALLOWED_CHANNELS = [PUBLIC_CHANNEL_ID, PRIVATE_CHANNEL_ID];

// --- Discord & WebSocket Clients ---
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const wss = new WebSocketServer({ port: WEBSOCKET_PORT });

// --- State Management ---
const connectedClients = new Map<string, WebSocket>();
const clientConnectionOrder: string[] = [];
const pendingResetAcks = new Map<string, (value: unknown) => void>();

// --- Message Formatting ---
function formatEventForDiscord(eventName: string, data: any): { content: string | null; embeds?: EmbedBuilder[] } {
    if (eventName === 'message' && data.message) {
        const msg = data.message;
        
        // Skip internal processing messages
        if (msg.say === 'user_feedback') return { content: null };
        if (msg.say === 'reasoning') return { content: null };
        if (msg.say === 'api_req_started') return { content: null };
        if (msg.say === 'api_req_finished') return { content: null };
        if (msg.say === 'command_output') return { content: null };
        if (msg.text && msg.text.includes('Failed to fetch LiteLLM models')) return { content: null };

        // Show tool usage (may need approval)
        if (msg.say === 'tool') return { content: `🛠️ Using a tool...` };
        
        // Only show meaningful text responses (prevent echoing user messages)
        if (msg.say === 'text' && msg.text?.trim() && !msg.text.startsWith('{"request":')) {
            return { content: msg.text };
        }
        
        // Handle completion results
        if (msg.say === 'completion_result' && msg.text?.trim()) {
            return { content: msg.text };
        }

        // Show questions to user
        if (msg.ask === 'followup') {
            try {
                const parsed = JSON.parse(msg.text);
                let formatted = `❓ **Question:**\n${parsed.question || ''}`;
                if (Array.isArray(parsed.suggest)) {
                    formatted += '\n\n**Please choose an option:**';
                    parsed.suggest.forEach((choice: any, index: number) => {
                        formatted += `\n\n${index + 1}. ${choice.label || choice.answer}`;
                    });
                }
                return { content: formatted };
            } catch (e) {
                return { content: `❓ **Question:**\n${msg.text}` };
            }
        }
    }
    // For all other events or message types, return nothing to display.
    return { content: null };
}

// --- Message Sending Logic ---
async function sendMessage(channelId: string, options: { content: string | null; embeds?: EmbedBuilder[] }) {
    const { content, embeds } = options;
    if (!content && (!embeds || embeds.length === 0)) return;

    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;

    try {
        await (channel as TextChannel).send({ content: content || undefined, embeds });
    } catch (error) {
        console.error(`❌ Error sending message:`, error);
    }
}


function processMessage(channelId: string, eventName: string, data: any) {
    const isPartial = data?.message?.partial;
    
    // Skip all partial messages to avoid streaming issues in Discord
    if (isPartial && data?.message?.say !== 'completion_result') {
        return;
    }
    
    const formatted = formatEventForDiscord(eventName, data);
    
    // Skip null content to avoid unnecessary processing
    if (!formatted.content && (!formatted.embeds || formatted.embeds.length === 0)) {
        return;
    }
    
    // Only send final messages (non-partial)
    sendMessage(channelId, formatted);
}


// --- WebSocket Logic ---
wss.on('connection', (ws: WebSocket, req) => {
    const clientId = new URLSearchParams(req.url?.split('?')[1] || '').get('clientId');
    if (!clientId) { ws.close(); return; }

    if (connectedClients.has(clientId)) {
        connectedClients.get(clientId)?.terminate();
        const index = clientConnectionOrder.indexOf(clientId);
        if (index > -1) clientConnectionOrder.splice(index, 1);
    }

    connectedClients.set(clientId, ws);
    clientConnectionOrder.push(clientId);
    (ws as any).clientId = clientId;
    updateClientStatus();

    ws.on('message', async (data) => {
        const message = JSON.parse(data.toString());
        console.log('📨 WS Received:', message);

        if (message.type === 'ack' && message.command === 'reset') {
            console.log('✅ Reset ACK received for channel:', message.channelId);
            pendingResetAcks.get(message.channelId)?.(true);
            pendingResetAcks.delete(message.channelId);
        } else if (message.type === 'event' && message.channelId) {
            // Only 'message' events are processed for display
            if (message.eventName === 'message') {
                processMessage(message.channelId, message.eventName, message.data);
            }
        }
    });

    ws.on('close', () => handleDisconnect(clientId));
    ws.on('error', () => handleDisconnect(clientId));
});

function handleDisconnect(clientId: string) {
    connectedClients.delete(clientId);
    const index = clientConnectionOrder.indexOf(clientId);
    if (index > -1) clientConnectionOrder.splice(index, 1);
    updateClientStatus();
}

function updateClientStatus() {
    clientConnectionOrder.forEach((id, index) => {
        const clientWs = connectedClients.get(id);
        if (clientWs?.readyState === WebSocket.OPEN) {
            const isActive = index === 0;
            clientWs.send(JSON.stringify({ type: 'connection', isActive }));
        }
    });
    console.log(`📋 Active client: ${clientConnectionOrder[0] || 'None'}`);
}

function broadcastToActiveClient(data: any) {
    if (clientConnectionOrder.length === 0) return;
    const activeClient = connectedClients.get(clientConnectionOrder[0]);
    if (activeClient?.readyState === WebSocket.OPEN) {
        activeClient.send(JSON.stringify(data));
        console.log(`📤 Sent to active client: ${clientConnectionOrder[0]}`);
    } else {
        handleDisconnect(clientConnectionOrder[0]);
        broadcastToActiveClient(data); // Retry with new leader
    }
}

// --- Discord Event Handlers ---
client.once(Events.ClientReady, c => console.log(`🤖 Logged in as ${c.user.tag}`));

client.on(Events.MessageCreate, msg => {
    if (msg.author.bot || !ALLOWED_CHANNELS.includes(msg.channel.id)) return;
    broadcastToActiveClient({ type: 'message', content: msg.content, channelId: msg.channel.id });
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || !ALLOWED_CHANNELS.includes(interaction.channelId)) return;
    const { commandName, options, channelId } = interaction;

    if (commandName === 'reset' || commandName === 'new' || commandName === 'stop') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const ackPromise = new Promise(resolve => {
            const timeout = setTimeout(() => {
                if (pendingResetAcks.has(channelId)) {
                    pendingResetAcks.delete(channelId);
                    resolve(false); // Timeout
                }
            }, 5000);

            pendingResetAcks.set(channelId, (value) => {
                clearTimeout(timeout);
                resolve(value);
            });
        });

        broadcastToActiveClient({ type: 'command', command: commandName, channelId });

        const ackReceived = await ackPromise;

        if (!ackReceived) {
            await interaction.editReply({ content: '❌ Reset command timed out. The VS Code extension may be disconnected or unresponsive.' });
            return;
        }

        if (commandName === 'new') {
            broadcastToActiveClient({ type: 'message', content: options.getString('message', true), channelId });
            await interaction.editReply({ content: '🚀 New task started!' });
        } else { // For 'reset' and 'stop'
            await interaction.editReply({ content: `✅ Task ${commandName}ped successfully.` });
        }
    }
});

// --- Startup & Shutdown ---
client.login(DISCORD_TOKEN);
process.on('SIGINT', () => { wss.close(); client.destroy(); process.exit(0); });
process.on('SIGTERM', () => { wss.close(); client.destroy(); process.exit(0); });