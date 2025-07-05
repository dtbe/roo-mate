# Discord-to-Roo-Code Message Flow Implementation

## Overview
This document describes the implementation of task 1.4 - the Discord-to-Roo-Code message flow that enables seamless communication between Discord DMs and the Roo Code API.

## Message Flow

### 1. Discord Bot (discord-bot/src/index.ts)
When a DM is received from the target user:

#### Reset Command
- **Input**: `/reset` message from target user
- **Output**: JSON payload to WebSocket clients:
```json
{
  "type": "command",
  "command": "reset"
}
```

#### Regular Messages
- **Input**: Any other message from target user
- **Output**: JSON payload to WebSocket clients:
```json
{
  "type": "message", 
  "content": "the user's message"
}
```

### 2. VS Code Extension (roo-lay/src/extension.ts)
Processes incoming JSON payloads from the Discord bot:

#### Reset Command Handler
- **Input**: `{ "type": "command", "command": "reset" }`
- **Actions**:
  - Calls `rooCodeApi.cancelCurrentTask()`
  - Sets `activeTaskId` to `null`
  - Shows information message confirming reset

#### Message Handler
- **Input**: `{ "type": "message", "content": "user message" }`
- **Actions**:
  - **If no active task**: 
    - Calls `rooCodeApi.startNewTask({ text: payload.content })`
    - Stores returned task ID in `activeTaskId`
    - Shows information message about new task
  - **If active task exists**:
    - Calls `rooCodeApi.sendMessage(payload.content)`
    - Shows information message about message sent

## User Experience

1. **First DM**: Starts a new task in Roo Code
2. **Subsequent DMs**: Send messages to the active task
3. **Reset DM** (`/reset`): Cancels the active task and resets state
4. **VS Code notifications**: Confirm all actions with information messages

## Technical Implementation

### Discord Bot Changes
- Modified message event handler to detect `/reset` command
- Changed payload format to use simpler `type` and `content`/`command` structure
- Added logging for better debugging

### VS Code Extension Changes
- Updated `handleDiscordMessage()` method to handle new payload format
- Added explicit handling for command vs message types
- Maintained backwards compatibility with legacy message format
- Enhanced logging and error handling
- Improved user feedback with clearer notification messages

## Building and Running

### Discord Bot
```bash
cd 00-Repositories/00/roo-mate/discord-bot
npm run build
npm start
```

### VS Code Extension
```bash
cd 00-Repositories/00/roo-mate/roo-lay
npm run compile
# Then install/reload extension in VS Code
```

## Dependencies
- Discord bot requires environment variables: `DISCORD_TOKEN`, `TARGET_USER`, `WEBSOCKET_PORT`
- VS Code extension requires `rooveterinaryinc.roo-cline` extension to be installed
- WebSocket connection on `ws://localhost:8080` (configurable)

## Testing
1. Start Discord bot with WebSocket server
2. Install and activate roo-lay extension in VS Code
3. Send DM to bot - should start new task
4. Send another DM - should add to existing task
5. Send `/reset` - should cancel active task
6. Verify VS Code shows appropriate notification messages