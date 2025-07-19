import discord
from discord.ext import commands
import os
from dotenv import load_dotenv
import asyncio
import websockets
import json
import logging
import argparse

# --- Setup Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Argument Parsing ---
parser = argparse.ArgumentParser(description="Run a configurable Discord bot.")
parser.add_argument("--port", type=int, required=True, help="WebSocket port to listen on.")
parser.add_argument("--token-var", type=str, default="DISCORD_TOKEN", help="Environment variable name for the Discord token.")
parser.add_argument("--channel-var", type=str, required=True, help="Environment variable name for the target channel ID.")
args = parser.parse_args()

# --- Load Environment Variables ---
load_dotenv()
DISCORD_TOKEN = os.getenv(args.token_var)
# The only channel the bot will listen to for messages and commands.
TARGET_CHANNEL_ID = os.getenv(args.channel_var)

# --- State Management ---
class BotState:
    def __init__(self):
        self.websocket_client = None
        self.websocket_server = None
        self.task_message_buffer = {}  # Key: taskId, Value: latest message content

state = BotState()

# --- Bot Setup ---
intents = discord.Intents.default()
intents.messages = True
intents.message_content = True

bot = commands.Bot(command_prefix="!", intents=intents)

# --- Helper Functions ---
async def send_long_message(channel, text):
    """Sends a message, splitting it into chunks if it's too long."""
    if not text or not isinstance(text, str) or not text.strip():
        logging.warning("Attempted to send an empty or invalid message.")
        return

    if len(text) <= 2000:
        await channel.send(text)
    else:
        logging.info("Message is too long, splitting into chunks.")
        for i in range(0, len(text), 2000):
            await channel.send(text[i:i+2000])

# --- Bot Events ---
@bot.event
async def on_ready():
    logging.info(f'Logged in as {bot.user.name} (ID: {bot.user.id})')
    logging.info(f'Listening only in channel: {TARGET_CHANNEL_ID}')
    logging.info('------')

@bot.event
async def on_message(message):
    # Ignore messages from the bot itself or from any other channel
    if message.author.bot or str(message.channel.id) != TARGET_CHANNEL_ID:
        return

    # Let the library process any potential commands first
    await bot.process_commands(message)

    # If it's not a command, handle it as a regular message
    if not message.content.startswith(bot.command_prefix):
        logging.info(f"Message from {message.author.name}: '{message.content}'")

        if state.websocket_client:
            logging.info("Formatting and forwarding message to WebSocket.")
            
            # Prepend the username to the message content for multi-user context
            formatted_content = f"#{message.author.display_name}: {message.content}"
            
            payload = {
                "type": "message",
                "content": formatted_content,
                "channelId": str(message.channel.id)
            }
            await state.websocket_client.send(json.dumps(payload))
        else:
            logging.warning("Cannot forward message: WebSocket is not connected.")

# --- Bot Commands ---
@bot.command(name="shutdown")
async def shutdown_command(ctx):
    """Shuts down the bot."""
    await ctx.send("Shutting down...")
    if state.websocket_server:
        state.websocket_server.close()
        await state.websocket_server.wait_closed()
    await bot.close()

@bot.command(name="new")
async def new_task_command(ctx):
    """Signals the external service to start a new task."""
    if state.websocket_client:
        logging.info("Sending 'new' command to WebSocket client.")
        payload = {
            "type": "command",
            "command": "new",
            "channelId": str(ctx.channel.id)
        }
        await state.websocket_client.send(json.dumps(payload))
        await ctx.send("🚀 New task context started!", delete_after=10)
    else:
        logging.warning("Cannot start new task: WebSocket is not connected.")
        await ctx.send("Cannot start a new task.")

# --- WebSocket Logic ---
def format_and_filter_message(data):
    if data.get('type') != 'event' or data.get('eventName') != 'message':
        return None
    
    msg = data.get('data', {}).get('message', {})
    if not msg: return None

    if msg.get('say') in ['user_feedback', 'reasoning', 'api_req_started', 'api_req_finished', 'command_output', 'text']:
        return None
    if msg.get('text') and ('rate limiting' in msg['text'] or 'rate limit' in msg['text']):
        return None
    
    if msg.get('ask') == 'followup':
        try:
            parsed = json.loads(msg.get('text', '{}'))
            question = parsed.get('question', '')
            suggestions = parsed.get('suggest', [])
            
            formatted_message = f"❓ **Question:**\n{question}"
            if suggestions:
                formatted_message += "\n\n**Please choose an option:**"
                for i, choice in enumerate(suggestions):
                    label = choice.get('label') if isinstance(choice, dict) else choice
                    answer = choice.get('answer') if isinstance(choice, dict) else choice
                    formatted_message += f"\n\n{i+1}. {label or answer}"
            return formatted_message
        except (json.JSONDecodeError, AttributeError):
            return f"❔ **Question:**\n{msg.get('text', '')}"

    if msg.get('say') == 'completion_result' and msg.get('text', '').strip():
        return f"✅ {msg.get('text')}"

    return None

async def websocket_handler(websocket):
    state.websocket_client = websocket
    logging.info("Extension connected via WebSocket.")
    
    await websocket.send(json.dumps({"type": "connection", "isActive": True}))
    logging.info("Sent 'leader' acknowledgement to extension.")

    try:
        async for message in websocket:
            logging.info(f"Received message from WebSocket: {message}")
            data = json.loads(message)

            if data.get('type') != 'event' or data.get('eventName') != 'message':
                continue

            event_data = data.get('data', {})
            msg_payload = event_data.get('message', {})
            task_id = event_data.get('taskId')
            channel_id = data.get('channelId')

            if not all([msg_payload, task_id, channel_id]):
                continue

            formatted_content = format_and_filter_message(data)
            if not formatted_content:
                continue
            
            is_partial = msg_payload.get('partial', False)

            if is_partial:
                # Buffer the partial message content
                state.task_message_buffer[task_id] = formatted_content
                logging.info(f"Buffered partial message for task {task_id}")
            else:
                # This is the final message
                final_content = state.task_message_buffer.pop(task_id, formatted_content)
                logging.info(f"Received final message for task {task_id}. Sending to Discord.")
                try:
                    channel = await bot.fetch_channel(int(channel_id))
                    await send_long_message(channel, final_content)
                except discord.NotFound:
                    logging.error(f"Discord channel {channel_id} not found.")
                except Exception as e:
                    logging.error(f"Failed to send final message to channel {channel_id}: {e}")

    except websockets.exceptions.ConnectionClosed:
        logging.warning("Extension disconnected.")
    finally:
        state.websocket_client = None
        state.task_message_buffer.clear()

async def start_websocket_server():
    logging.info(f"Starting WebSocket server on localhost:{args.port}...")
    state.websocket_server = await websockets.serve(websocket_handler, "localhost", args.port)
    try:
        await state.websocket_server.wait_closed()
    except asyncio.CancelledError:
        logging.info("WebSocket server task cancelled.")

# --- Main Execution ---
async def main():
    if not all([DISCORD_TOKEN, TARGET_CHANNEL_ID]):
        logging.error(f"Environment variables '{args.token_var}' and '{args.channel_var}' must be set.")
        return

    async with bot:
        loop = asyncio.get_event_loop()
        loop.create_task(start_websocket_server())
        await bot.start(DISCORD_TOKEN)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("Bot shutting down via KeyboardInterrupt.")