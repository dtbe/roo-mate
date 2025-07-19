# Discord Bot V2 - Simple DM Relay

This bot is a simple, stateless message relay designed to forward Direct Messages (DMs) from a specific Discord channel to the `roo-code` VS Code extension.

## Core Principles

*   **Stateless**: The bot does not store any conversation history or state.
*   **DM Focused**: It only listens to a single, specific DM channel.
*   **Simple Relay**: Its only job is to pass messages between Discord and the `roo-lay` extension.

## Setup and Installation

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Create `.env` File**:
    Create a file named `.env` in this directory (`discord-bot-v2`) and add the following variables:

    ```env
    DISCORD_TOKEN=your_bot_token_here
    DM_CHANNEL_ID=your_dm_channel_id_here
    ```

    *   `DISCORD_TOKEN`: Your Discord bot's token.
    *   `DM_CHANNEL_ID`: The ID of the DM channel you want the bot to listen to. To get this, right-click on the DM channel with the bot (or your own message) and select "Copy Channel ID". You may need to enable Developer Mode in your Discord settings first.

## Running the Bot

1.  **Build the Code**:
    Compile the TypeScript code into JavaScript:
    ```bash
    npm run build
    ```

2.  **Start the Bot**:
    Run the compiled code:
    ```bash
    npm run start
    ```

    You can also use the `dev` script to automatically recompile and restart the bot when you make changes:
    ```bash
    npm run dev
    ```

## How it Works

*   The bot connects to Discord and listens for messages in the specific DM channel defined in your `.env` file.
*   When a message is received, it is sent to the `roo-lay` extension via a WebSocket connection on `ws://localhost:8080`.
*   The `roo-lay` extension processes the message.
    *   If it's a regular message, the extension treats it as a continuation of the current task (`sendMessage`).
    *   If the message is `/new`, the extension knows to start a new task (`startNewTask`).
*   The extension sends a response back to the bot via the WebSocket.
*   The bot sends this response back to the user in the DM channel.

The `/new` command is handled entirely by the `roo-lay` extension's logic. This bot simply forwards the message, and the extension interprets it as a command to start a new task. No special deployment is needed for this command.