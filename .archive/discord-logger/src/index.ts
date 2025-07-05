import { Client, GatewayIntentBits, Partials, ChannelType } from 'discord.js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const PRIVATE_CHANNEL_ID = process.env.PRIVATE_CHANNEL_ID; // Optional: for a specific private channel
const PUBLIC_CHANNEL_ID = process.env.PUBLIC_CHANNEL_ID;   // Optional: for a specific public channel
const BASE_PATH = process.env.USER_HOME_DIR || 'c:/Users/dan/Home'; // Use USER_HOME_DIR from .env or default
const LOG_FILE_PATH = path.join(BASE_PATH, '00-Repositories', '00', 'roo-mate', 'discord-logger', 'discord_messages.jsonl');
const WATCHED_FILE_PATH = path.join(BASE_PATH, '00-Repositories', '00', 'roo-mate', 'discord-logger', 'roo_code_input.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user?.tag}!`);
  // Ensure log file exists
  if (!fs.existsSync(LOG_FILE_PATH)) {
    fs.writeFileSync(LOG_FILE_PATH, '');
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return; // Ignore bot messages

  const logEntry = {
    timestamp: new Date().toISOString(),
    channelId: message.channel.id,
    channelName: (message.channel.type === ChannelType.DM) ? 'DM' : (message.channel as any).name,
    authorId: message.author.id,
    authorUsername: message.author.username,
    content: message.content,
    isMentioned: message.mentions.users.has(client.user?.id || ''),
  };

  // Append message to local log file
  fs.appendFileSync(LOG_FILE_PATH, JSON.stringify(logEntry) + '\n');
  console.log(`Logged message from ${logEntry.authorUsername} in #${logEntry.channelName}`);

  // If bot is mentioned, trigger Roo Code
  if (logEntry.isMentioned) {
    console.log(`Bot mentioned by ${logEntry.authorUsername}. Triggering Roo Code...`);

    // Fetch recent messages for context
    const messages = fs.readFileSync(LOG_FILE_PATH, 'utf-8').split('\n')
      .filter(line => line.trim() !== '')
      .map(line => JSON.parse(line));

    const recentMessages = messages.slice(-10); // Get last 10 messages for context

    let instruction = message.content;
    let ttsRequested = false;

    // Check for -tts flag
    if (message.content.toLowerCase().includes('-tts')) {
      ttsRequested = true;
      instruction = instruction.replace(/-tts/gi, '').trim(); // Remove flag from instruction
    }

    const rooCodePayload = {
      trigger: 'discord_mention',
      discord: {
        channelId: logEntry.channelId,
        channelName: logEntry.channelName,
        authorId: logEntry.authorId,
        authorUsername: logEntry.authorUsername,
        messageContent: logEntry.content,
        instruction: instruction, // Cleaned instruction for LLM
        ttsRequested: ttsRequested, // Flag for LLM to consider TTS
        recentMessages: recentMessages, // Provide context
      },
      // Add other relevant context for Roo Code LLM here
    };

    fs.writeFileSync(WATCHED_FILE_PATH, JSON.stringify(rooCodePayload, null, 2));
    console.log(`Roo Code trigger file updated: ${WATCHED_FILE_PATH}`);
  }
});

client.login(DISCORD_TOKEN);