import { REST } from '@discordjs/rest';
import { Routes, ApplicationCommandType } from 'discord-api-types/v10';
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord-api-types/v10';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN is required in environment variables');
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error('❌ CLIENT_ID is required in environment variables');
    process.exit(1);
}

if (!GUILD_ID) {
    console.error('❌ GUILD_ID is required in environment variables');
    process.exit(1);
}

// Define the slash commands
const commands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
    {
        name: 'reset',
        description: 'Cancels the current Roo Code task and resets the conversation.',
        type: ApplicationCommandType.ChatInput,
    },
    {
        name: 'new',
        description: 'Starts a new conversation with Roo Code. Use this if the bot seems stuck or to begin a fresh topic.',
        type: ApplicationCommandType.ChatInput,
    },
];

// Create REST client
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

// Deploy commands
async function deployCommands() {
    try {
        console.log('🔄 Started refreshing application (/) commands.');

        // Register commands for a specific guild
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID!, GUILD_ID!),
            { body: commands }
        );

        console.log('✅ Successfully reloaded application (/) commands.');
        console.log(`📋 Deployed ${commands.length} commands:`);
        commands.forEach(cmd => {
            console.log(`   - /${cmd.name}: ${cmd.description}`);
        });
    } catch (error) {
        console.error('❌ Error deploying commands:', error);
    }
}

// Run the deployment
deployCommands();