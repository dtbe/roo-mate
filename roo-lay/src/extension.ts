import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import * as WebSocket from 'ws';
import { createHash } from 'crypto';

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
                choices?: { label: string; value: string; }[]; // Add choices for ask messages
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
    getConfiguration(): any;
    handleWebviewAskResponse(askResponse: any, text?: string, images?: string[]): Promise<void>;
}

// WebSocket configuration
const WEBSOCKET_URL = 'ws://localhost:8080';
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 30000;

// Global state
let activeTaskId: string | null = null;
let wsClientInstance: WebSocketClient | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let reconnectDelay = RECONNECT_DELAY_MS;
let isExtensionActive = true;
let isResettingTask = false; // New flag to indicate if a reset command was issued
const messageCache = new Map<string, number>();
const CACHE_EXPIRATION_MS = 10000; // 10-second window to catch duplicates

// Helper function to get Roo Code API
function getRooCodeApi(): RooCodeAPI | undefined {
    const extension = vscode.extensions.getExtension<RooCodeAPI>("rooveterinaryinc.roo-cline");
    if (!extension) {
        vscode.window.showErrorMessage("Roo Code extension not found. Please install 'rooveterinaryinc.roo-cline'.");
        return undefined;
    }
    if (!extension.isActive) {
        extension.activate();
    }
    return extension.exports;
}

// WebSocket client implementation
class WebSocketClient {
    private ws: WebSocket.WebSocket | null = null;
    private context: vscode.ExtensionContext;
    private rooCodeApi: RooCodeAPI | undefined;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.rooCodeApi = getRooCodeApi();
        this.setupRooCodeEventListeners();
    }

    private setupRooCodeEventListeners(): void {
        if (!this.rooCodeApi) {
            console.warn('Roo Code API not available during event listener setup');
            return;
        }

        // Listen for messages from Roo Code API
        this.rooCodeApi.on(RooCodeEventName.Message, (event) => {
            // --- Deduplication Logic ---
            const textContent = event.message?.text || event.message?.reasoning || '';
            const contentHash = createHash('sha256').update(textContent).digest('hex');
            const eventId = event.message?.ts ? `${event.taskId}-${event.message.ts}-${contentHash}` : null;

            if (eventId) {
                const now = Date.now();
                // Clean up old entries from the cache
                for (const [id, timestamp] of messageCache.entries()) {
                    if (now - timestamp > CACHE_EXPIRATION_MS) {
                        messageCache.delete(id);
                    }
                }

                // If the event is already in the cache, ignore it
                if (messageCache.has(eventId)) {
                    console.log(`[roo-lay] Duplicate message detected, not forwarding: ${eventId}`);
                    return; // Stop processing the duplicate event
                }
                // Otherwise, add it to the cache
                messageCache.set(eventId, now);
            }

            this.sendToDiscord({
                type: 'event',
                eventName: 'message',
                data: {
                    taskId: event.taskId,
                    action: event.action,
                    message: event.message
                }
            });
        });

        // Listen for task completion
        this.rooCodeApi.on(RooCodeEventName.TaskCompleted, (taskId, usage) => {
            // Don't clear activeTaskId on task completion - only clear it on explicit reset
            this.sendToDiscord({
                type: 'event',
                eventName: 'taskCompleted',
                data: {
                    taskId,
                    usage
                }
            });
        });

        // Listen for other task events
        this.rooCodeApi.on(RooCodeEventName.TaskCreated, (taskId) => {
            // Update activeTaskId when a new task is created
            console.log(`Task created: ${taskId}, setting as activeTaskId`);
            activeTaskId = taskId;
            this.sendToDiscord({
                type: 'event',
                eventName: 'taskCreated',
                data: { taskId }
            });
        });

        this.rooCodeApi.on(RooCodeEventName.TaskStarted, (taskId) => {
            this.sendToDiscord({
                type: 'event',
                eventName: 'taskStarted',
                data: { taskId }
            });
        });

        this.rooCodeApi.on(RooCodeEventName.TaskAborted, (taskId) => {
            // Clear activeTaskId if it's the current task being aborted
            if (taskId === activeTaskId) {
                console.log(`Task aborted: ${taskId}, clearing activeTaskId (reset: ${isResettingTask})`);
                activeTaskId = null;
            }
            this.sendToDiscord({
                type: 'event',
                eventName: 'taskAborted',
                data: { taskId }
            });
        });
    }

    public connect(): void {
        if (!isExtensionActive || this.ws) return; // Prevent multiple connections

        try {
            console.log('Attempting to connect to WebSocket server...');
            this.ws = new WebSocket.WebSocket(WEBSOCKET_URL);

            if (this.ws) {
                this.ws.on('open', () => {
                    console.log('WebSocket connected to Discord bot');
                    vscode.window.showInformationMessage('Connected to Discord bot');
                    reconnectDelay = RECONNECT_DELAY_MS; // Reset delay on successful connection
                    
                    // Clear any pending reconnect timeout
                    if (reconnectTimeout) {
                        clearTimeout(reconnectTimeout);
                        reconnectTimeout = null;
                    }
                });

                this.ws.on('message', (data: WebSocket.RawData) => {
                    try {
                        const message = JSON.parse(data.toString());
                        this.handleDiscordMessage(message);
                    } catch (error) {
                        console.error('Error parsing WebSocket message:', error);
                        vscode.window.showErrorMessage('Error parsing message from Discord bot');
                    }
                });

                this.ws.on('close', (code: number, reason: string) => {
                    console.log(`WebSocket connection closed: ${code} ${reason}`);
                    this.ws = null;
                    
                    if (isExtensionActive) {
                        this.scheduleReconnect();
                    }
                });

                this.ws.on('error', (error: Error) => {
                    console.error('WebSocket error:', error);
                    vscode.window.showErrorMessage(`WebSocket error: ${error.message}`);
                    this.ws = null;
                    
                    if (isExtensionActive) {
                        this.scheduleReconnect();
                    }
                });
            }

        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            if (isExtensionActive) {
                this.scheduleReconnect();
            }
        }
    }

    private scheduleReconnect(): void {
        if (reconnectTimeout) return; // Already scheduled

        console.log(`Scheduling reconnect in ${reconnectDelay}ms`);
        reconnectTimeout = setTimeout(() => {
            reconnectTimeout = null;
            if (isExtensionActive) {
                this.connect();
                // Exponential backoff with max delay
                reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY_MS);
            }
        }, reconnectDelay);
    }

    private async handleDiscordMessage(message: any): Promise<void> {
        if (!this.rooCodeApi) {
            console.error('Roo Code API not available');
            return;
        }

        try {
            console.log('Received Discord message:', message);

            // Handle command messages (reset)
            if (message.type === 'command' && message.command === 'reset') {
                console.log('Processing reset command from Discord');
                isResettingTask = true; // Set the flag when a reset command is received
                if (activeTaskId) {
                    await this.rooCodeApi.cancelCurrentTask();
                    vscode.window.showInformationMessage('Active task cancelled by Discord reset command');
                } else {
                    vscode.window.showInformationMessage('No active task to reset');
                }
                // Clear activeTaskId immediately after cancelling for reset commands
                console.log('Clearing activeTaskId due to reset command');
                activeTaskId = null;
                isResettingTask = false; // Reset the flag after processing the command
                return;
            }

            // Handle save_to_kb command
            if (message.type === 'command' && message.command === 'save_to_kb') {
                console.log('Processing save_to_kb command from Discord');
                const knowledgeBasePrompt = `A user has submitted the following information to be saved to the knowledge base. Your task is to perform an intelligent assimilation by following the "Intelligent Assimilation Workflow" defined in the KNOWLEDGE_ASSIMILATION_PROTOCOL.md. Assess the content, decide whether to update, append, create, or discard it, and then execute the action. Provide a summary of your actions upon completion.\n\n---\n\n**Submitted Content:**\n${message.content}`;
                
                try {
                    await this.rooCodeApi.startNewTask({
                        text: knowledgeBasePrompt
                    });
                    vscode.window.showInformationMessage('Knowledge base assimilation task started.');
                } catch (error) {
                    console.error('Failed to start knowledge base task:', error);
                    vscode.window.showErrorMessage('Failed to start knowledge base assimilation task.');
                }
                return;
            }

            // Handle regular message
            if (message.type === 'message' && message.content) {
                console.log('Processing message from Discord:', message.content);
                console.log(`Current activeTaskId: ${activeTaskId}`);
                
                if (activeTaskId) {
                    // Send message to existing task
                    console.log(`Sending message to existing task: ${activeTaskId}`);
                    try {
                        await this.rooCodeApi.sendMessage(message.content);
                        vscode.window.showInformationMessage(`Message sent to active task: ${activeTaskId}`);
                    } catch (error) {
                        console.error('Failed to send message to existing task:', error);
                        vscode.window.showErrorMessage('Failed to send message to active task');
                        // Don't clear activeTaskId here - let the TaskAborted event handle it
                    }
                } else {
                    // Start new task
                    console.log('No active task, starting new task with content:', message.content);
                    try {
                        await this.rooCodeApi.startNewTask({
                            text: message.content
                        });
                        vscode.window.showInformationMessage('New task started from Discord message');
                    } catch (error) {
                        console.error('Failed to start new task:', error);
                        vscode.window.showErrorMessage('Failed to start new task from Discord message');
                    }
                }
                return;
            }

            // Handle legacy message format (for backwards compatibility)
            if (message.text) {
                console.log('Processing legacy message format:', message.text);
                
                if (activeTaskId) {
                    // Send message to existing task
                    try {
                        await this.rooCodeApi.sendMessage(message.text, message.images);
                        vscode.window.showInformationMessage(`Message sent to active task: ${activeTaskId}`);
                    } catch (error) {
                        console.error('Failed to send legacy message to existing task:', error);
                        vscode.window.showErrorMessage('Failed to send message to active task');
                    }
                } else {
                    // Start new task
                    try {
                        const config = this.rooCodeApi.getConfiguration();
                        const updatedConfig = {
                            ...config,
                            mode: message.mode || 'ask',
                            discordContext: {
                                channelId: message.channelId,
                                userId: message.userId,
                                username: message.username
                            }
                        };

                        const newTaskId = await this.rooCodeApi.startNewTask({
                            configuration: updatedConfig,
                            text: message.text,
                            images: message.images
                        });

                        vscode.window.showInformationMessage(`New task started from Discord: ${newTaskId}`);
                    } catch (error) {
                        console.error('Failed to start new legacy task:', error);
                        vscode.window.showErrorMessage('Failed to start new task from Discord message');
                    }
                }
                return;
            }

            // Handle ask response (existing functionality)
            if (message.type === 'askResponse' && activeTaskId) {
                await this.rooCodeApi.handleWebviewAskResponse(
                    message.askResponse,
                    message.text,
                    message.images
                );
                return;
            }

            console.warn('Unhandled Discord message format:', message);
        } catch (error) {
            console.error('Error handling Discord message:', error);
            vscode.window.showErrorMessage(`Error processing Discord message: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private sendToDiscord(data: any): void {
        if (this.ws && this.ws.readyState === WebSocket.WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(data));
            } catch (error) {
                console.error('Error sending message to Discord bot:', error);
            }
        } else {
            console.warn('WebSocket not connected, cannot send message to Discord bot');
        }
    }

    public isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.WebSocket.OPEN;
    }

    public disconnect(): void {
        isExtensionActive = false;
        
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, "roo-lay" is now active!');
    
    isExtensionActive = true;
    
    // Ensure only one instance of the client is created (singleton)
    if (!wsClientInstance) {
        console.log('Creating new WebSocketClient instance.');
        wsClientInstance = new WebSocketClient(context);
        wsClientInstance.connect();

        // Cleanup on deactivation
        context.subscriptions.push(new vscode.Disposable(() => {
            if (wsClientInstance) {
                wsClientInstance.disconnect();
                wsClientInstance = null;
            }
        }));
    } else {
        console.log('WebSocketClient instance already exists.');
        // Only reconnect if not currently connected
        if (!wsClientInstance.isConnected()) {
            console.log('Reconnecting existing WebSocketClient instance.');
            wsClientInstance.connect();
        } else {
            console.log('WebSocketClient already connected.');
        }
    }

    // Register commands if needed
    const disposable = vscode.commands.registerCommand('roo-lay.triggerRooCode', () => {
        vscode.window.showInformationMessage('Roo Relay is active and connected via WebSocket');
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {
    console.log('"roo-lay" is now deactivated!');
    
    isExtensionActive = false;
    
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    
    if (wsClientInstance) {
        wsClientInstance.disconnect();
        wsClientInstance = null;
    }
}