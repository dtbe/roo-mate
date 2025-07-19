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

// GUILD_ID is no longer required for global commands.
// if (!GUILD_ID) {
//     console.error('❌ GUILD_ID is required in environment variables');
//     process.exit(1);
// }

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
        options: [
            {
                name: 'message',
                description: 'The initial message to start the new task.',
                type: 3, // ApplicationCommandOptionType.String
                required: true,
            },
        ],
    },
    {
        name: 'approve',
        description: 'Approves the last requested action from Roo.',
        type: ApplicationCommandType.ChatInput,
    },
    {
        name: 'deny',
        description: 'Denies the last requested action from Roo.',
        type: ApplicationCommandType.ChatInput,
    },
    {
        name: 'save',
        description: 'Saves a piece of information to the knowledge base for intelligent assimilation.',
        type: ApplicationCommandType.ChatInput,
        options: [
            {
                name: 'content',
                description: 'The information you want to save to the knowledge base.',
                type: 3, // ApplicationCommandOptionType.String
                required: true,
            },
        ],
    },
    {
        name: 'stop',
        description: 'Stops the bot and all associated processes gracefully.',
        type: ApplicationCommandType.ChatInput,
    },
];

// Create REST client
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

// Deploy commands
async function deployCommands() {
    try {
        console.log('🔄 Started refreshing application (/) commands.');

        // Register commands globally
        await rest.put(
            Routes.applicationCommands(CLIENT_ID!),
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