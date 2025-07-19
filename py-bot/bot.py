import discord
from discord.ext import commands
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
OWNER_ID = os.getenv("OWNER_ID")

# Define intents
intents = discord.Intents.default()
intents.messages = True
intents.message_content = True

# Create bot instance
bot = commands.Bot(command_prefix="!", intents=intents)

@bot.event
async def on_ready():
    """Event listener for when the bot has connected to Discord."""
    print(f'Logged in as {bot.user.name}')
    print(f'Bot ID: {bot.user.id}')
    print('------')

@bot.command(name='shutdown')
async def shutdown(ctx):
    """Shuts down the bot. Only the owner can use this command."""
    # Convert OWNER_ID from .env to integer for comparison
    owner_id = int(OWNER_ID)
    if ctx.author.id == owner_id:
        await ctx.send("Shutting down...")
        await bot.close()
    else:
        await ctx.send("You do not have permission to use this command.")

if __name__ == "__main__":
    if not DISCORD_TOKEN:
        print("Error: DISCORD_TOKEN not found in .env file.")
    elif not OWNER_ID:
        print("Error: OWNER_ID not found in .env file.")
    else:
        bot.run(DISCORD_TOKEN)