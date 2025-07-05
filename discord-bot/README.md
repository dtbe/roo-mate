# Roo-Mate Discord Bot

A Discord bot with WebSocket server for the Roo-Lay v2 project. This bot listens for Direct Messages from a specified user and broadcasts them to connected WebSocket clients.

## Features

- Discord bot that listens for DMs from a specified user
- Slash commands support (`/reset` and `/new`)
- WebSocket server for real-time communication
- TypeScript implementation with proper type safety
- Graceful shutdown handling
- Configurable via environment variables

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   - Copy `.env.example` to `.env`
   - Add your Discord bot token, client ID, and configure other settings

3. **Deploy slash commands:**
   ```bash
   npm run deploy
   ```

4. **Build the project:**
   ```bash
   npm run build
   ```

5. **Run the bot:**
   ```bash
   npm start
   ```

   Or for development with hot reload:
   ```bash
   npm run dev
   ```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DISCORD_TOKEN` | Your Discord bot token | Required |
| `CLIENT_ID` | Your Discord application client ID | Required |
| `WEBSOCKET_PORT` | Port for WebSocket server | 8080 |
| `TARGET_USER` | Discord username to listen for DMs | Required |

## Discord Bot Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Copy the Application ID (this is your CLIENT_ID)
4. Go to the "Bot" section
5. Create a bot and copy the token
6. Enable the following privileged intents:
   - Message Content Intent
7. Invite the bot to your server or ensure it can receive DMs

## WebSocket API

The bot broadcasts messages to connected WebSocket clients in the following format:

```json
{
  "type": "discord_message",
  "user": "username",
  "content": "message content",
  "timestamp": "2023-01-01T00:00:00.000Z",
  "messageId": "123456789"
}
```

Connection messages:
```json
{
  "type": "connection",
  "message": "Connected to Discord bot WebSocket server",
  "timestamp": "2023-01-01T00:00:00.000Z"
}
```

## Scripts

- `npm run build` - Build the TypeScript project
- `npm start` - Run the built application
- `npm run dev` - Run in development mode with ts-node
- `npm run watch` - Watch for changes and rebuild
- `npm run deploy` - Deploy slash commands to Discord

## Architecture

The application runs both a Discord bot and WebSocket server in a single process:

1. **Discord Bot**: Connects to Discord and listens for DMs from the specified user
2. **WebSocket Server**: Provides real-time communication with connected clients
3. **Message Broadcasting**: When a DM is received from the target user, it's broadcasted to all connected WebSocket clients

## Slash Commands

The bot supports the following slash commands in DMs:

- `/reset` - Cancels the current Roo Code task and resets the conversation
- `/new` - Starts a new conversation with Roo Code (same as `/reset`)

Both commands trigger a reset of the current task and allow starting fresh.

## Usage

1. Start the bot with `npm start`
2. The bot will log in to Discord and start the WebSocket server
3. Connect WebSocket clients to `ws://localhost:8080` (or your configured port)
4. Send DMs to the bot from the configured target user or use slash commands
5. Messages and command responses will be broadcasted to all connected WebSocket clients

## Error Handling

The bot includes comprehensive error handling:
- Graceful shutdown on SIGINT/SIGTERM
- WebSocket connection cleanup
- Discord client error logging
- Automatic cleanup of closed WebSocket connections