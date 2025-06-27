# roo-mate

This project provides a simple integration between Discord and the Roo Code LLM, allowing the LLM to process Discord messages and respond intelligently.

## Components

*   **`discord-logger`**: A Discord bot that logs messages locally and triggers the Roo Code LLM when mentioned.
*   **`roo-relay`**: A VS Code extension that acts as a bridge, relaying messages from `discord-logger` to the Roo Code LLM.

## Getting Started

### 1. Discord Logger Setup

This component logs Discord messages and prepares them for the Roo Code LLM.

1.  **Navigate to the `discord-logger` directory:**
    ```bash
    cd roo-mate/discord-logger
    ```
2.  **Configure Credentials:**
    Edit the `.env` file in this directory and replace the placeholder values with your Discord bot token and channel IDs.
    ```
    DISCORD_TOKEN="YOUR_DISCORD_BOT_TOKEN_HERE"
    PRIVATE_CHANNEL_ID="YOUR_PRIVATE_CHANNEL_ID_HERE"
    PUBLIC_CHANNEL_ID="YOUR_PUBLIC_CHANNEL_ID_HERE"
    ```
3.  **Install Dependencies (if not already done):**
    ```bash
    npm install
    ```
4.  **Build the Project:**
    ```bash
    npm run build
    ```
5.  **Start the Discord Logger Bot:**
    ```bash
    npm start
    ```

### 2. Roo Relay (VS Code Extension) Setup

This extension relays messages to the Roo Code LLM.

1.  **Open the `roo-relay` folder in VS Code:**
    Open a new VS Code window and select `File > Open Folder...`, then navigate to `roo-mate/roo-relay`.
2.  **Run in Development Mode:**
    Press `F5`. This will launch a new VS Code Extension Development Host window with the `roo-relay` extension active.

## How it Works

The `discord-logger` bot listens for messages. When it's mentioned, it compiles relevant message history and writes it to a file (`roo_code_input.json`). The `roo-relay` VS Code extension watches this file. When the file changes, `roo-relay` reads the content and passes it to the Roo Code LLM via the VS Code API. The LLM then processes the message and can respond using its own Discord MCP tool or trigger TTS via ElevenLabs MCP.