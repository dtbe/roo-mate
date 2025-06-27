import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Assuming Roo Code API is exposed via an extension export
// This needs to be verified. The roo-code.ts file shows an interface.
// We need to get the extension and its exports.
interface RooCodeAPI {
  startNewTask(options: { configuration?: any; text?: string; images?: string[] }): Promise<string>;
  getConfiguration(): any; // Should be RooCodeSettings from roo-code.ts
  // Add other methods from RooCodeAPI as needed
}

// Path to the watched file
const WATCHED_FILE_PATH = path.join(vscode.workspace.rootPath || '', '00-Repositories', '00', 'roo-mate', 'discord-logger', 'roo_code_input.json');

// Helper function to get Roo Code API
function getRooCodeApi(): RooCodeAPI | undefined {
  const extension = vscode.extensions.getExtension<RooCodeAPI>("rooveterinaryinc.roo-cline"); // Assuming this is the correct extension ID
  if (!extension) {
    vscode.window.showErrorMessage("Roo Code extension not found. Please install 'rooveterinaryinc.roo-cline'.");
    return undefined;
  }
  if (!extension.isActive) {
    extension.activate(); // Try to activate if not active
  }
  return extension.exports;
}

// Message instruction builder (simplified for now, can be expanded)
class MessageInstructionBuilder {
    private header: string[] = [];
    private conversationContext: string = '';
    private assistantInstructions: string[] = [];
    private currentMessage: string = '';
    private ttsInstructions: string[] | undefined;

    addHeader(payload: any): this {
        this.header = [
            `DISCORD_CHANNEL_ID=${payload.discord.channelId}`,
            `DISCORD_USER_NAME=${payload.discord.authorUsername}`,
            `DISCORD_MESSAGE_ID=${payload.discord.messageContent}`, // Assuming messageContent is unique enough for ID
            `IS_DIRECT_MENTION=true`, // Assuming all triggers are direct mentions for now
            `HAS_TTS=${payload.discord.ttsRequested}`
        ];
        return this;
    }

    addHistory(recentMessages: any[]): this {
        const historyText = recentMessages
            .map((msg: any, i: number) => `MESSAGE_${i + 1} [${msg.timestamp}]: ${msg.authorUsername}: ${msg.content}`)
            .join('\n');
        
        this.conversationContext = `## CONVERSATION CONTEXT (Last ${recentMessages.length} Messages)\n${historyText}`;
        return this;
    }

    addInstructions(): this {
        this.assistantInstructions = [
            '## ASSISTANT INSTRUCTIONS',
            '1. **Initial Micro-Planning (CRITICAL):** Before responding, create a brief internal plan:',
            '   - **Assess Research Need:** Does this query require external research (Perplexity, Firecrawl, BraveSearch, Tavily) to provide a comprehensive and accurate answer? If yes, outline the research steps.',
            '   - **Priorise Research:** If research is needed, perform ALL necessary research and analysis BEFORE sending ANY response to Discord.',
            '   - **Formulate Single Answer:** Based on all available information (including research results), formulate a single, comprehensive answer.',
            '',
            '2. Response Guidelines:',
            '   - If you decide to respond, you MUST use mcp-discord to send your response:',
            '     * channel: [Use DISCORD_CHANNEL_ID from header]',
            '     * message: [Your single, comprehensive response in British English]',
            '   - After sending your SINGLE final response via mcp-discord, you MUST use `attempt_completion` to signal the end of this task instance. Do NOT send multiple messages for one query.',
            '   - If you want to ask a follow-up question:',
            '     * Use mcp-discord with a clear question',
            '     * Never ask questions directly in the response text',
            '   - Keep messages under 1900 characters.',
            '   - Match conversation tone.',
            '   - React with 🦘 for direct mentions.',
            '   - NEVER respond without using mcp-discord - always use it to send messages.'
        ];
        return this;
    }

    addMessage(content: string): this {
        this.currentMessage = `## CURRENT MESSAGE\n${content}`;
        return this;
    }

    addOptionalTts(ttsRequested: boolean): this {
        if (ttsRequested) {
            this.ttsInstructions = [
                '',
                '### TTS (Text-to-Speech) OPTION',
                'TTS was explicitly requested (-tts flag). Use mcp-discord to send TTS:',
                '- channel: [Use DISCORD_CHANNEL_ID from header]',
                '- tts: true',
                '- message: "[Shorter version of your response, optimised for speech]"',
                '',
                'TTS Guidelines:',
                '- Keep TTS version under 200 characters',
                '- Remove formatting and special characters',
                '- Use conversational tone',
                '- Focus on key points only',
                '- This TTS was explicitly requested with -tts'
            ];
        }
        return this;
    }

    toString(): string {
        const parts = [
            this.header.join('\n'),
            this.conversationContext,
            this.assistantInstructions.join('\n'),
            this.currentMessage
        ];

        if (this.ttsInstructions) {
            parts.push(this.ttsInstructions.join('\n'));
        }

        return parts.join('\n\n');
    }
}


export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, "roo-relay" is now active!');

  // Ensure the watched file exists, or create it
  if (!fs.existsSync(WATCHED_FILE_PATH)) {
    fs.writeFileSync(WATCHED_FILE_PATH, '');
  }

  // Watch the file for changes
  fs.watch(WATCHED_FILE_PATH, async (eventType, filename) => {
    if (eventType === 'change') {
      console.log(`Watched file changed: ${filename}`);
      try {
        const fileContent = fs.readFileSync(WATCHED_FILE_PATH, 'utf8');
        const payload = JSON.parse(fileContent);

        const rooCodeApi = getRooCodeApi();
        if (!rooCodeApi) {
          vscode.window.showErrorMessage("Roo Code API not available. Cannot trigger LLM.");
          return;
        }

        // Build the task instructions string
        const instructionBuilder = new MessageInstructionBuilder()
            .addHeader(payload)
            .addHistory(payload.discord.recentMessages)
            .addInstructions()
            .addMessage(payload.discord.messageContent)
            .addOptionalTts(payload.discord.ttsRequested);

        const taskInstructions = instructionBuilder.toString();

        // Prepare the configuration with discordContext
        const currentConfig = rooCodeApi.getConfiguration();
        const updatedConfig = {
            ...currentConfig,
            mode: 'ask', // Assuming 'ask' mode is appropriate for Discord interactions
            discordContext: { // This will be passed to the LLM's context
                channelId: payload.discord.channelId,
                channelName: payload.discord.channelName,
                authorId: payload.discord.authorId,
                authorUsername: payload.discord.authorUsername,
                messageContent: payload.discord.messageContent,
                ttsRequested: payload.discord.ttsRequested,
            }
        };

        // Start a new task with the constructed instructions and configuration
        await rooCodeApi.startNewTask({
            configuration: updatedConfig,
            text: taskInstructions
        });

        vscode.window.showInformationMessage('Roo Code LLM triggered with Discord message!');

      } catch (error) {
        console.error('Error processing watched file:', error);
        vscode.window.showErrorMessage('Error processing Discord message for Roo Code LLM.');
      }
    }
  });
}

export function deactivate() {
  console.log('"roo-relay" is now deactivated!');
}