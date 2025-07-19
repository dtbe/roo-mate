import discord
from discord.ext import commands
from discord import app_commands
import os
from dotenv import load_dotenv
import asyncio
import websockets
import json
import logging

# --- Setup Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Load Environment Variables ---
load_dotenv()
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
OWNER_ID = os.getenv("OWNER_ID")
TESTING_CHANNEL_ID = os.getenv("TESTING_CHANNEL_ID")
GUILD_ID = os.getenv("GUILD_ID")

# --- State Management ---
class BotState:
    def __init__(self):
        self.active_task_channel_id = None
        self.websocket_client = None
        self.websocket_server = None

state = BotState()

# --- Bot Setup ---
intents = discord.Intents.default()
intents.messages = True
intents.message_content = True

class MyBot(commands.Bot):
    def __init__(self, guild_id):
        super().__init__(command_prefix="!unused!", intents=intents)
        self.guild_id = guild_id

    async def setup_hook(self):
        guild = discord.Object(id=self.guild_id)
        self.tree.copy_global_to(guild=guild)
        await self.tree.sync(guild=guild)
        logging.info(f"Slash commands synced to guild {self.guild_id}.")

bot = MyBot(guild_id=int(GUILD_ID))

# --- Helper Functions ---
async def send_long_message(channel, text):
    """Sends a message, splitting it into chunks if it's too long."""
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
    logging.info('------')

@bot.event
async def on_message(message):
    if message.author.bot or str(message.channel.id) != TESTING_CHANNEL_ID:
        return

    logging.info(f"Message from {message.author.name}: '{message.content}'")

    if state.websocket_client:
        # If there's an active task in this channel, continue it. Otherwise, start a new one.
        is_new_task = state.active_task_channel_id != message.channel.id
        
        logging.info(f"Forwarding message to WebSocket. New task: {is_new_task}")
        payload = {
            "type": "message",
            "content": message.content,
            "channelId": str(message.channel.id),
            "new_task": is_new_task # Custom flag for roo-lay to interpret
        }
        await state.websocket_client.send(json.dumps(payload))
        state.active_task_channel_id = message.channel.id # Set this channel as having an active task
    else:
        logging.warning("Cannot forward message: WebSocket is not connected.")

# --- Bot Commands ---
@bot.tree.command(name="shutdown", description="Shuts down the bot (Owner only).")
@app_commands.check(lambda i: str(i.user.id) == OWNER_ID)
async def shutdown_command(interaction: discord.Interaction):
    await interaction.response.send_message("Shutting down...", ephemeral=True)
    if state.websocket_server:
        state.websocket_server.close()
        await state.websocket_server.wait_closed()
    await bot.close()

@bot.tree.command(name="new", description="Starts a new task.")
async def new_task_command(interaction: discord.Interaction):
    if str(interaction.channel_id) != TESTING_CHANNEL_ID:
        await interaction.response.send_message("This command can only be used in the designated testing channel.", ephemeral=True)
        return

    if state.websocket_client:
        logging.info("Clearing active task and sending 'new' command to WebSocket client.")
        state.active_task_channel_id = None # Clear the active task
        payload = {
            "type": "command",
            "command": "new",
            "channelId": str(interaction.channel_id)
        }
        await state.websocket_client.send(json.dumps(payload))
        await interaction.response.send_message("🚀 New task started!", ephemeral=True)
    else:
        logging.warning("Cannot start new task: WebSocket is not connected.")
        await interaction.response.send_message("Cannot start a new task.", ephemeral=True)

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
            
            # When a task is created, store its channel ID
            if data.get('eventName') == 'taskCreated':
                task_id = data.get('data', {}).get('taskId')
                channel_id = data.get('channelId')
                if task_id and channel_id:
                    state.active_task_channel_id = int(channel_id)
                    logging.info(f"Task {task_id} started in channel {channel_id}.")

            formatted_content = format_and_filter_message(data)
            
            if formatted_content:
                channel_id = data.get('channelId')
                if channel_id:
                    logging.info(f"Relaying formatted message to Discord channel {channel_id}")
                    try:
                        channel = await bot.fetch_channel(int(channel_id))
                        await send_long_message(channel, formatted_content)
                    except discord.NotFound:
                        logging.error(f"Discord channel {channel_id} not found.")
                    except Exception as e:
                        logging.error(f"Failed to send message to channel {channel_id}: {e}")

    except websockets.exceptions.ConnectionClosed:
        logging.warning("Extension disconnected.")
    finally:
        state.websocket_client = None
        state.active_task_channel_id = None

async def start_websocket_server():
    logging.info("Starting WebSocket server on localhost:8080...")
    state.websocket_server = await websockets.serve(websocket_handler, "localhost", 8080)
    try:
        await state.websocket_server.wait_closed()
    except asyncio.CancelledError:
        logging.info("WebSocket server task cancelled.")

# --- Main Execution ---
async def main():
    if not all([DISCORD_TOKEN, OWNER_ID, TESTING_CHANNEL_ID, GUILD_ID]):
        logging.error("One or more required environment variables are missing.")
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