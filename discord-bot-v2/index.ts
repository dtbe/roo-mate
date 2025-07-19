import { Client, GatewayIntentBits, ChannelType, Partials } from 'discord.js';
import WebSocket from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [ Partials.Channel ] // Required to receive DMs
});

const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
    console.log('Extension connected via WebSocket.');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());
            if (data.channelId && data.content) {
                const channel = await client.channels.fetch(data.channelId);
                if (channel && 'send' in channel && typeof channel.send === 'function') {
                    // This is a more robust check to ensure the channel has a send method
                    await channel.send(data.content);
                }
            }
        } catch (error) {
            console.error('Error processing message from extension:', error);
        }
    });

    ws.on('close', () => {
        console.log('Extension disconnected.');
    });

    client.on('messageCreate', (message) => {
        if (message.author.bot) return;

        // Check if the message is a Direct Message
        if (message.channel.type === ChannelType.DM) {
            console.log(`DM received from ${message.author.username}. Forwarding to extension.`);
            if (ws.readyState === WebSocket.OPEN) {
                const data = {
                    content: message.content,
                    channelId: message.channel.id,
                };
                ws.send(JSON.stringify(data));
            } else {
                console.log('WebSocket is not open. Cannot forward message.');
            }
        }
    });
});

client.on('ready', () => {
    console.log(`Bot v2 is logged in as ${client.user?.tag} and ready.`);
});

client.login(process.env.DISCORD_TOKEN);

console.log('Starting Discord bot v2...');