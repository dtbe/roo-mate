# Roo-Mate: Discord Relay for Roo Code

## Overview

Roo-Mate is a real-time communication bridge that connects a Discord Direct Message conversation to the Roo Code VS Code extension. This enables seamless interaction with AI assistants through Discord while maintaining the full functionality of the Roo Code extension within your development environment.

The system creates a bidirectional communication channel where messages sent to a Discord bot are relayed to the Roo Code extension, and responses from the extension are sent back to Discord in real-time.

## Architecture

The system follows a clean client-server architecture with WebSocket communication:

```
[Discord User] <--> [Discord Bot (WebSocket Server)] <--> [VS Code Extension (WebSocket Client)] <--> [Roo Code API]
```

### Data Flow
1. User sends a Direct Message to the Discord bot
2. Discord bot receives the message and forwards it via WebSocket to the VS Code extension
3. VS Code extension processes the message through the Roo Code API
4. Response is sent back through the WebSocket to the Discord bot
5. Discord bot sends the response back to the user as a DM

## Components

### Discord Bot (`discord-bot/`)
- **Type**: WebSocket Server
- **Function**: Handles Discord API interactions and maintains WebSocket connections
- **Key Features**:
  - Receives and sends Direct Messages
  - Manages WebSocket server for VS Code extension connections
  - Supports slash commands (`/reset`, `/new`) for conversation management
  - Handles user authentication and message routing

### VS Code Extension (`roo-lay/`)
- **Type**: WebSocket Client
- **Function**: Bridges Discord communication with the Roo Code extension
- **Key Features**:
  - Connects to Discord bot's WebSocket server
  - Integrates with Roo Code API for AI interactions
  - Maintains conversation state and context
  - Handles real-time message relay

## Setup and Running Instructions

### Prerequisites
- Node.js (v16 or higher)
- VS Code with Roo Code extension installed
- Discord Bot Token and Application ID

### 1. Discord Bot Setup

1. Navigate to the Discord bot directory:
   ```bash
   cd 00-Repositories/00/roo-mate/discord-bot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create environment configuration:
   - Copy `.env.example` to `.env`
   - Fill in the required values:
     - `DISCORD_TOKEN`: Your Discord bot token
     - `CLIENT_ID`: Your Discord application client ID  
     - `TARGET_USER_ID`: Discord user ID who can interact with the bot

4. Register slash commands with Discord:
   ```bash
   npm run deploy
   ```

5. Start the Discord bot:
   ```bash
   npm start
   ```

   The bot will start and display a WebSocket server URL (typically `ws://localhost:3001`).

### 2. VS Code Extension Setup

1. Open the extension directory in VS Code:
   ```bash
   code 00-Repositories/00/roo-mate/roo-lay/
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Launch the extension in debug mode:
   - Press `F5` in VS Code
   - This will open a new Extension Development Host window

4. The extension will automatically attempt to connect to the Discord bot's WebSocket server.

## Usage

### Starting a Conversation

Once both components are running:

1. **Send a Direct Message** to your Discord bot to begin a conversation
2. The message will be relayed to the Roo Code extension
3. Responses will be sent back to you via Discord DM

### Managing Conversations

Use these slash commands in Discord to manage your conversation:

- `/reset` - Start a fresh conversation (clears context)
- `/new` - Begin a new conversation session
- `/stop` - Stops the bot and all associated processes gracefully.

### Troubleshooting

**Connection Issues:**
- Ensure the Discord bot is running and shows "WebSocket server listening"
- Verify the VS Code extension shows a successful WebSocket connection
- Check that firewall settings allow WebSocket connections on the configured port

**Authentication Issues:**
- Verify your `TARGET_USER_ID` is correctly set in the Discord bot's `.env` file
- Ensure you're messaging the bot from the authorised Discord account

**Message Relay Issues:**
- Check both component logs for error messages
- Restart both the Discord bot and VS Code extension
- Verify the Roo Code extension is properly installed and activated

## Development

The project uses TypeScript for both components:

- **Discord Bot**: Standard Node.js application with Discord.js and WebSocket server
- **VS Code Extension**: Uses VS Code Extension API with WebSocket client capabilities

To modify or extend functionality, refer to the individual README files in each component directory for detailed development instructions.

## License

This project is part of the Roo Code ecosystem. Refer to individual component licenses for specific terms.