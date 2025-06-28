import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

// Re-defining RooCodeEvents and RooCodeEventName based on roo-code.ts for self-containment
export type RooCodeEvents = {
    message: [
        {
            taskId: string;
            action: "created" | "updated";
            message: {
                ts: number;
                type: "ask" | "say";
                ask?: "followup" | "command" | "command_output" | "completion_result" | "tool" | "api_req_failed" | "resume_task" | "resume_completed_task" | "mistake_limit_reached" | "browser_action_launch" | "use_mcp_server" | "finishTask";
                say?: "task" | "error" | "api_req_started" | "api_req_finished" | "api_req_retried" | "api_req_retry_delayed" | "api_req_deleted" | "text" | "reasoning" | "completion_result" | "user_feedback" | "user_feedback_diff" | "command_output" | "tool" | "shell_integration_warning" | "browser_action" | "browser_action_result" | "command" | "mcp_server_request_started" | "mcp_server_response" | "new_task_started" | "new_task" | "subtask_result" | "checkpoint_saved" | "rooignore_error" | "diff_error";
                text?: string;
                images?: string[];
                partial?: boolean;
                reasoning?: string;
                conversationHistoryIndex?: number;
                checkpoint?: { [x: string]: unknown; };
                progressStatus?: { icon?: string; text?: string; };
            };
        },
    ];
    taskCreated: [string];
    taskStarted: [string];
    taskModeSwitched: [string, string];
    taskPaused: [string];
    taskUnpaused: [string];
    taskAskResponded: [string];
    taskAborted: [string];
    taskSpawned: [string, string];
    taskCompleted: [
        string,
        {
            totalTokensIn: number;
            totalTokensOut: number;
            totalCacheWrites?: number;
            totalCacheReads?: number;
            totalCost: number;
            contextTokens: number;
        },
    ];
    taskTokenUsageUpdated: [
        string,
        {
            totalTokensIn: number;
            totalTokensOut: number;
            totalCacheWrites?: number;
            totalCacheReads?: number;
            totalCost: number;
            contextTokens: number;
        },
    ];
};

export enum RooCodeEventName {
    Message = "message",
    TaskCreated = "taskCreated",
    TaskStarted = "taskStarted",
    TaskModeSwitched = "taskModeSwitched",
    TaskPaused = "taskPaused",
    TaskUnpaused = "taskUnpaused",
    TaskAskResponded = "taskAskResponded",
    TaskAborted = "taskAborted",
    TaskSpawned = "taskSpawned",
    TaskCompleted = "taskCompleted",
    TaskTokenUsageUpdated = "taskTokenUsageUpdated",
}

// Assuming Roo Code API is exposed via an extension export
interface RooCodeAPI extends EventEmitter<RooCodeEvents> {
  startNewTask(options: { configuration?: any; text?: string; images?: string[] }): Promise<string>;
  sendMessage(text?: string, images?: string[]): Promise<void>;
  cancelCurrentTask(): Promise<void>;
  getConfiguration(): any; // Should be RooCodeSettings from roo-code.ts
  // Add other methods from RooCodeAPI as needed
}

// Path to the watched file
const WATCHED_FILE_PATH = path.join(vscode.workspace.rootPath || '', '00-Repositories', '00', 'roo-mate', 'interface', 'commands.json');
const WEB_TERMINAL_RESPONSES_PATH = path.join(vscode.workspace.rootPath || '', '00-Repositories', '00', 'roo-mate', 'interface', 'responses.json');

let activeTaskId: string | null = null;

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

    addHeader(payload: any, source: 'discord' | 'web-terminal'): this {
        if (source === 'discord') {
            this.header = [
                `SOURCE=DISCORD`,
                `DISCORD_CHANNEL_ID=${payload.discord.channelId}`,
                `DISCORD_USER_NAME=${payload.discord.authorUsername}`,
                `DISCORD_MESSAGE_ID=${payload.discord.messageContent}`, // Assuming messageContent is unique enough for ID
                `IS_DIRECT_MENTION=true`, // Assuming all triggers are direct mentions for now
                `HAS_TTS=${payload.discord.ttsRequested}`
            ];
        } else if (source === 'web-terminal') {
            this.header = [
                `SOURCE=WEB_TERMINAL`,
                `WEB_TERMINAL_COMMAND=${payload.command}`,
                `WEB_TERMINAL_TIMESTAMP=${payload.timestamp}`
            ];
        }
        return this;
    }

    addHistory(recentMessages: any[], source: 'discord' | 'web-terminal'): this {
        if (source === 'discord') {
            const historyText = recentMessages
                .map((msg: any, i: number) => `MESSAGE_${i + 1} [${msg.timestamp}]: ${msg.authorUsername}: ${msg.content}`)
                .join('\n');
            
            this.conversationContext = `## CONVERSATION CONTEXT (Last ${recentMessages.length} Messages)\n${historyText}`;
        } else if (source === 'web-terminal') {
            // For web terminal, history might be managed differently or not needed in the same way
            this.conversationContext = `## WEB TERMINAL CONTEXT\nNo specific history provided, process current command.`;
        }
        return this;
    }

    addInstructions(source: 'discord' | 'web-terminal'): this {
        this.assistantInstructions = [
            '## ASSISTANT INSTRUCTIONS',
            '1. **Initial Micro-Planning (CRITICAL):** Before responding, create a brief internal plan:',
            '   - **Assess Research Need:** Does this query require external research (Perplexity, Firecrawl, BraveSearch, Tavily) to provide a comprehensive and accurate answer? If yes, outline the research steps.',
            '   - **Priorise Research:** If research is needed, perform ALL necessary research and analysis BEFORE sending ANY response.',
            '   - **Formulate Single Answer:** Based on all available information (including research results), formulate a single, comprehensive answer.',
            '',
            '2. Response Guidelines:',
        ];

        if (source === 'discord') {
            this.assistantInstructions.push(
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
            );
        } else if (source === 'web-terminal') {
            this.assistantInstructions.push(
                `   - Formulate your single, comprehensive response in British English.`,
                `   - After formulating your response, you MUST use \`attempt_completion\` to signal the end of this task instance. Do NOT send multiple responses for one query.`,
                `   - If you want to ask a follow-up question, include it in your final response.`
            );
        }
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
        const lines = fileContent.split('\n').filter(line => line.trim() !== '');
        if (lines.length === 0) {
            return; // No new commands
        }
        const lastLine = lines[lines.length - 1];
        const payload = JSON.parse(lastLine); // Assuming each line is a JSON object

        // Clear the commands.json file after reading the last command
        fs.writeFileSync(WATCHED_FILE_PATH, '');

        const rooCodeApi = getRooCodeApi();
        if (!rooCodeApi) {
          vscode.window.showErrorMessage("Roo Code API not available. Cannot trigger LLM.");
          return;
        }

        if (payload.command === '/reset') {
            if (activeTaskId) {
                await rooCodeApi.cancelCurrentTask();
                activeTaskId = null;
            }
            vscode.window.showInformationMessage(`Terminal reset.`);
            return;
        }

        if (activeTaskId) {
            await rooCodeApi.sendMessage(payload.command);
            vscode.window.showInformationMessage(`Message sent to active task: ${activeTaskId}`);
        } else {
            let taskInstructions: string;
            let updatedConfig: any;
            let source: 'discord' | 'web-terminal';
    
            if (payload.command) {
                source = 'web-terminal';
                const instructionBuilder = new MessageInstructionBuilder()
                    .addHeader(payload, source)
                    .addHistory([], source) 
                    .addInstructions(source)
                    .addMessage(payload.command);
                taskInstructions = instructionBuilder.toString();
                updatedConfig = {
                    ...rooCodeApi.getConfiguration(),
                    mode: 'ask', 
                    webTerminalContext: { 
                        command: payload.command,
                        timestamp: payload.timestamp,
                    }
                };
            } else {
                console.warn('Unknown payload format in watched file:', payload);
                return;
            }
    
            activeTaskId = await rooCodeApi.startNewTask({
                configuration: updatedConfig,
                text: taskInstructions
            });
    
            vscode.window.showInformationMessage(`New task started! Task ID: ${activeTaskId}`);
            
            const messageHandler = (event: any) => {
                if (event.taskId === activeTaskId && event.message.type === 'say' && event.message.say === 'completion_result') {
                    const llmResponse = event.message.text;
                    if (llmResponse) {
                        let existingResponses: { messages: any[] } = { messages: [] };
                        try {
                            const responsesContent = fs.readFileSync(WEB_TERMINAL_RESPONSES_PATH, 'utf8');
                            existingResponses = JSON.parse(responsesContent);
                        } catch (readError) {
                            console.warn(`Could not read existing responses.json: ${readError}. Starting fresh.`);
                        }
                        
                        existingResponses.messages.push(llmResponse);
                        fs.writeFileSync(WEB_TERMINAL_RESPONSES_PATH, JSON.stringify(existingResponses, null, 2));
                    }
                }
            };
            rooCodeApi.on(RooCodeEventName.Message, messageHandler);

            const completionHandler = (completedTaskId: string) => {
                if (completedTaskId === activeTaskId) {
                    activeTaskId = null;
                    rooCodeApi.off(RooCodeEventName.TaskCompleted, completionHandler);
                    rooCodeApi.off(RooCodeEventName.Message, messageHandler);
                }
            };
            rooCodeApi.on(RooCodeEventName.TaskCompleted, completionHandler);

            context.subscriptions.push(new vscode.Disposable(() => rooCodeApi.off(RooCodeEventName.Message, messageHandler)));
            context.subscriptions.push(new vscode.Disposable(() => rooCodeApi.off(RooCodeEventName.TaskCompleted, completionHandler)));
        }

      } catch (error) {
        console.error('Error processing watched file:', error);
        vscode.window.showErrorMessage('Error processing message for Roo Code LLM.');
      }
    }
  });
}

export function deactivate() {
  console.log('"roo-relay" is now deactivated!');
}