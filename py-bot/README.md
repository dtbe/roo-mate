# Python Discord Bot (Slash Commands)

A robust Discord bot built with Python to relay messages to a VS Code extension, using modern slash commands and intelligent state management.

## Features

- **/shutdown**: A secure slash command that only the bot owner can use.
- **/new**: A slash command to reset the context and start a new task with the extension.
- **WebSocket Relay**: Connects to the `roo-lay` VS Code extension to send and receive messages.
- **Message Filtering**: Intelligently filters messages from the extension to prevent spam and feedback loops.
- **Conversation Continuity**: Remembers the active channel to ensure subsequent messages continue the same task.
- **Graceful Shutdown**: Handles `Ctrl+C` and shutdown commands cleanly.
- **Long Message Handling**: Automatically splits messages that exceed Discord's character limit.

## Setup

1.  **Clone the repository:**
    ```bash
    git clone <your-repo-url>
    cd py-bot
    ```

2.  **Create a virtual environment:**
    ```bash
    python -m venv venv
    ```

3.  **Activate the virtual environment:**
    -   **Windows:**
        ```bash
        .\venv\Scripts\activate
        ```
    -   **macOS/Linux:**
        ```bash
        source venv/bin/activate
        ```

4.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

5.  **Configure environment variables:**
    -   Rename `.env.example` to `.env`.
    -   Open the `.env` file and add your credentials.
        ```
        DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE
        OWNER_ID=YOUR_DISCORD_USER_ID_HERE
        TESTING_CHANNEL_ID=YOUR_CHANNEL_ID_HERE
        GUILD_ID=YOUR_GUILD_ID_HERE
        ```

## Command Management

### Clearing Old Commands (Run Once)

If you have old, unused slash commands from previous bot versions registered to your Discord server, you can clear them by running this script **once**. Make sure your `.env` file is populated first.

```bash
python clear_commands.py
```

This will un-register all commands associated with your bot token for the specified server (Guild).

## Running the Bot

To start the bot, run the following command in your terminal:

```bash
python bot.py
```

The bot will start, connect to Discord, and register its new slash commands to your server. It will also wait for a connection from the `roo-lay` VS Code extension on `ws://localhost:8080`.

## Usage

All interaction with the bot now happens in your designated `TESTING_CHANNEL_ID`.

-   **Start a conversation**: The first message you send in the channel will start a new task.
-   **Continue a conversation**: Any subsequent messages will be sent as part of the active task.
-   `/new`: Clears the conversation history and starts a new task.
-   `/shutdown`: Shuts down the bot. Can only be used by the owner.