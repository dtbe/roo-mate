# Python Discord Bot

A simple, reliable Discord bot built with Python.

## Features

- **Shutdown Command**: A secure `!shutdown` command that only the bot owner can use.

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
    -   Open the `.env` file and add your Discord Bot Token and your Discord User ID.
        ```
        DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE
        OWNER_ID=YOUR_DISCORD_USER_ID_HERE
        ```

## Running the Bot

To start the bot, run the following command in your terminal:

```bash
python bot.py
```

## Usage

-   `!shutdown` - Shuts down the bot. Can only be used by the owner specified in the `.env` file.