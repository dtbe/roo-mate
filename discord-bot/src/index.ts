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
const DEBOUNCE_DELAY_MS = 350;

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
const activeStreamingMessages = new Map<string, Message>();
const messageBuffers = new Map<string, any>();
const debounceTimers = new Map<string, NodeJS.Timeout>();

// --- Message Formatting ---
function formatEventForDiscord(eventName: string, data: any): { content: string | null; embeds?: EmbedBuilder[] } {
    if (eventName !== 'message') return { content: null };

    const msg = data.message;
    if (msg.text && msg.text.includes('Failed to fetch LiteLLM models')) return { content: null };

    if (msg.say === 'reasoning') return { content: `🤔 *${msg.reasoning || msg.text || 'Processing...'}*` };
    if (msg.say === 'tool') return { content: `🛠️ Using a tool...` };
    if (msg.say === 'text' && msg.text?.trim()) return { content: msg.text };

    if (msg.ask === 'followup') {
        try {
            const parsed = JSON.parse(msg.text);
            let formatted = `❓ **Question:**\n${parsed.question || ''}`;
            if (Array.isArray(parsed.suggest)) {
                formatted += '\n\n**Please choose an option:**';
                parsed.suggest.forEach((choice: any, index: number) => {
                    formatted += `\n${index + 1}. ${choice.label || choice.answer}`;
                });
            }
            return { content: formatted };
        } catch (e) {
            return { content: `❓ **Question:**\n${msg.text}` };
        }
    }
    return { content: null };
}

// --- Message Sending Logic ---
async function sendOrUpdateMessage(channelId: string, options: { content: string | null; embeds?: EmbedBuilder[] }) {
    const { content, embeds } = options;
    if (!content && (!embeds || embeds.length === 0)) return;

    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;

    const existingMessage = activeStreamingMessages.get(channelId);

    try {
        if (existingMessage) {
            const newContent = (existingMessage.content + (content || '')).slice(-2000);
            await existingMessage.edit({ content: newContent, embeds });
        } else {
            const sentMessage = await (channel as TextChannel).send({ content: content || undefined, embeds });
            activeStreamingMessages.set(channelId, sentMessage);
        }
    } catch (error) {
        console.error(`❌ Error sending/editing message:`, error);
        activeStreamingMessages.delete(channelId); // Reset on error
    }
}

function processDebouncedMessage(channelId: string) {
    const bufferedData = messageBuffers.get(channelId);
    if (bufferedData) {
        const formatted = formatEventForDiscord('message', bufferedData);
        if (formatted) {
            sendOrUpdateMessage(channelId, formatted);
        }
    }
    messageBuffers.delete(channelId);
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
            pendingResetAcks.get(message.channelId)?.(true);
            pendingResetAcks.delete(message.channelId);
        } else if (message.type === 'event' && message.channelId) {
            const { channelId, data: eventData } = message;
            const isPartial = eventData?.message?.partial;

            if (debounceTimers.has(channelId)) clearTimeout(debounceTimers.get(channelId)!);

            messageBuffers.set(channelId, eventData);

            if (isPartial) {
                const timer = setTimeout(() => processDebouncedMessage(channelId), DEBOUNCE_DELAY_MS);
                debounceTimers.set(channelId, timer);
            } else {
                processDebouncedMessage(channelId);
                activeStreamingMessages.delete(channelId); // Final message, clear for next one
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

    if (commandName === 'reset' || commandName === 'new') {
        broadcastToActiveClient({ type: 'command', command: 'reset', channelId });
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const ackReceived = await new Promise(resolve => {
            pendingResetAcks.set(channelId, resolve);
            setTimeout(() => {
                if (pendingResetAcks.has(channelId)) {
                    pendingResetAcks.delete(channelId);
                    resolve(false);
                }
            }, 5000);
        });

        if (!ackReceived) {
            await interaction.editReply({ content: '❌ Reset command timed out.' });
            return;
        }

        if (commandName === 'new') {
            broadcastToActiveClient({ type: 'message', content: options.getString('message', true), channelId });
            await interaction.editReply({ content: '🚀 New task started!' });
        } else {
            await interaction.editReply({ content: '✅ Task reset successfully.' });
        }
    }
});

// --- Startup & Shutdown ---
client.login(DISCORD_TOKEN);
process.on('SIGINT', () => { wss.close(); client.destroy(); process.exit(0); });
process.on('SIGTERM', () => { wss.close(); client.destroy(); process.exit(0); });