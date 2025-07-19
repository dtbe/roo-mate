import discord
from discord.ext import commands
import asyncio
import os
from dotenv import load_dotenv

# --- Load Environment Variables ---
load_dotenv()
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
GUILD_ID = os.getenv("GUILD_ID")

async def clear_commands():
    """Connects to Discord and clears all application commands for a specific guild."""
    if not DISCORD_TOKEN or not GUILD_ID:
        print("Error: DISCORD_TOKEN and GUILD_ID must be set in the .env file.")
        return

    print("Attempting to connect to Discord to clear commands...")
    
    intents = discord.Intents.default()
    bot = commands.Bot(command_prefix="!", intents=intents)

    @bot.event
    async def on_ready():
        print(f"Logged in as {bot.user} to clear commands.")
        
        guild = discord.Object(id=int(GUILD_ID))
        
        try:
            # Clear commands for the specific guild
            print(f"Clearing commands for guild: {GUILD_ID}...")
            bot.tree.clear_commands(guild=guild)
            await bot.tree.sync(guild=guild)
            print(f"✅ Application commands for guild {GUILD_ID} have been cleared.")
            
            # Also clear global commands as a fallback
            print("Clearing global commands...")
            bot.tree.clear_commands(guild=None)
            await bot.tree.sync(guild=None)
            print("✅ Global application commands have been cleared.")

        except Exception as e:
            print(f"❌ Failed to clear commands: {e}")
        
        await bot.close()

    await bot.start(DISCORD_TOKEN)

if __name__ == "__main__":
    asyncio.run(clear_commands())