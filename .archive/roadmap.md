# Discord Bot V2 - DM Relay Roadmap

## Core Principles
1.  **Ultimate Simplicity**: The bot is a pure message relay for DMs.
2.  **No State**: The bot stores no conversation history, mode, or user data.
3.  **Separate Concerns**: This bot handles DMs only. A separate bot will be created for public channels later.

## Technical Strategy

### Architecture
A single, lightweight script that connects to Discord and relays DM messages to the `roo-code` backend.

### Core Components
1.  **Bot Process**: Connects to Discord and listens for DM events.
2.  **Message Handler**:
    *   Receives a DM.
    *   Forwards the message content directly to the `roo-code` backend.
    *   Receives a response from `roo-code`.
    *   Sends the response back to the user in the DM.

### Future Scope (Separate Bot for Public Channels)
*   A new bot project will be created.
*   It will prepend usernames to messages in group chats (e.g., `@username: message`).

### Extension Impact
*   To be determined. The current extension (`roo-lay/src/extension.ts`) needs to be reviewed to see if it needs changes to support the new bot.