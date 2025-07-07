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
const activeTaskIds = new Map<string, string>(); // Map channelId to taskId
const channelIdByTaskId = new Map<string, string>(); // Map taskId to channelId
let wsClientInstance: WebSocketClient | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let reconnectDelay = RECONNECT_DELAY_MS;
let isExtensionActive = true;
const messageCache = new Map<string, number>();
const CACHE_EXPIRATION_MS = 10000; // 10-second window to catch duplicates
let clientId: string | undefined;

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

        const genericEventHandler = (eventName: RooCodeEventName) => (taskId: string, data: any = {}) => {
            const channelId = channelIdByTaskId.get(taskId);
            if (channelId) {
                console.log(`[roo-lay] Forwarding event '${eventName}' for task ${taskId} to channel ${channelId}`);
                this.sendToDiscord({
                    type: 'event',
                    eventName,
                    channelId,
                    data: { taskId, ...data }
                });

                if (eventName === RooCodeEventName.TaskCompleted) {
                    // Don't delete from activeTaskIds, so the conversation can continue.
                    // The task is only truly "done" from roo-lay's perspective on /reset.
                    console.log(`[roo-lay] Task ${taskId} completed on backend. Cleaning up channelIdByTaskId map only.`);
                    channelIdByTaskId.delete(taskId);
                } else if (eventName === RooCodeEventName.TaskAborted) {
                    console.log(`[roo-lay] Task ${taskId} aborted. Cleaning up all maps for channel ${channelId}.`);
                    activeTaskIds.delete(channelId);
                    channelIdByTaskId.delete(taskId);
                }
            } else {
                console.warn(`[roo-lay] Received event '${eventName}' for task ${taskId}, but no channel is associated.`);
            }
        };

        this.rooCodeApi.on(RooCodeEventName.Message, (event) => {
            const channelId = channelIdByTaskId.get(event.taskId);
            if (channelId) {
                this.sendToDiscord({
                    type: 'event',
                    eventName: 'message',
                    channelId: channelId,
                    data: {
                        taskId: event.taskId,
                        action: event.action,
                        message: event.message
                    }
                });
            }
        });
        
        this.rooCodeApi.on(RooCodeEventName.TaskCreated, (taskId) => {
            // This event is tricky because we don't know the channelId yet.
            // We will associate it when startNewTask resolves.
            console.log(`[roo-lay] Task ${taskId} created by API.`);
        });

        this.rooCodeApi.on(RooCodeEventName.TaskStarted, genericEventHandler(RooCodeEventName.TaskStarted));
        this.rooCodeApi.on(RooCodeEventName.TaskCompleted, (taskId, usage) => genericEventHandler(RooCodeEventName.TaskCompleted)(taskId, { usage }));
        this.rooCodeApi.on(RooCodeEventName.TaskAborted, genericEventHandler(RooCodeEventName.TaskAborted));
    }

    public connect(): void {
        if (!isExtensionActive || this.ws) return; // Prevent multiple connections

        try {
            if (!clientId) {
                clientId = vscode.workspace.getConfiguration('roo-lay').get('clientId');
                if (!clientId) {
                    clientId = createHash('sha256').update(Date.now().toString() + Math.random().toString()).digest('hex');
                    vscode.workspace.getConfiguration('roo-lay').update('clientId', clientId, vscode.ConfigurationTarget.Global);
                }
            }
            const urlWithClientId = `${WEBSOCKET_URL}?clientId=${clientId}`;
            console.log(`Attempting to connect to WebSocket server at ${urlWithClientId}...`);
            this.ws = new WebSocket.WebSocket(urlWithClientId);

            if (this.ws) {
                this.ws.on('open', () => {
                    console.log('WebSocket connected to Discord bot');
                    reconnectDelay = RECONNECT_DELAY_MS; // Reset delay on successful connection
                    
                    // Clear any pending reconnect timeout
                    if (reconnectTimeout) {
                        clearTimeout(reconnectTimeout);
                        reconnectTimeout = null;
                    }
                    
                    // Note: Don't show connection message immediately - wait to see if we're active
                });

                this.ws.on('message', (data: WebSocket.RawData) => {
                    try {
                        const message = JSON.parse(data.toString());
                        
                        // Handle connection status messages
                        if (message.type === 'connection') {
                            vscode.window.showInformationMessage(`Connected to Discord bot: ${message.message}`);
                            return;
                        }
                        
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

            const { type, command, content, channelId } = message;

            if (!channelId) {
                console.error('[roo-lay] Received message without channelId, cannot process.');
                return;
            }

            const currentTaskId = activeTaskIds.get(channelId);

            // Handle command messages
            if (type === 'command') {
                if (command === 'reset') {
                    console.log(`[roo-lay] Processing reset command for channel ${channelId}`);
                    if (currentTaskId) {
                        await this.rooCodeApi.cancelCurrentTask(); // Assumes this cancels the task associated with the extension's internal state
                        vscode.window.showInformationMessage(`Active task in channel ${channelId} cancelled by Discord reset command`);
                    } else {
                        vscode.window.showInformationMessage(`No active task in channel ${channelId} to reset`);
                    }
                } else if (command === 'save_to_kb') {
                    console.log(`[roo-lay] Processing save_to_kb command for channel ${channelId}`);
                    const knowledgeBasePrompt = `A user has submitted the following information to be saved to the knowledge base. Your task is to perform an intelligent assimilation by following the "Intelligent Assimilation Workflow" defined in the KNOWLEDGE_ASSIMILATION_PROTOCOL.md. Assess the content, decide whether to update, append, create, or discard it, and then execute the action. Provide a summary of your actions upon completion.\n\n---\n\n**Submitted Content:**\n${content}`;
                    try {
                        // This creates a new task, independent of the channel's main conversation
                        const kbTaskId = await this.rooCodeApi.startNewTask({ text: knowledgeBasePrompt });
                        channelIdByTaskId.set(kbTaskId, channelId); // Associate with channel for response
                        vscode.window.showInformationMessage(`Knowledge base assimilation task ${kbTaskId} started for channel ${channelId}.`);
                    } catch (error) {
                        console.error('Failed to start knowledge base task:', error);
                    }
                }
                return;
            }

            // Handle regular messages
            if (type === 'message' && content) {
                if (currentTaskId) {
                    console.log(`[roo-lay] Sending message to existing task ${currentTaskId} in channel ${channelId}`);
                    try {
                        await this.rooCodeApi.sendMessage(content);
                        vscode.window.showInformationMessage(`Message sent to active task in channel ${channelId}`);
                    } catch (error) {
                        console.error(`Failed to send message to existing task ${currentTaskId}:`, error);
                        // This likely means the task was completed on the backend.
                        // We'll start a new task with the user's message to continue the conversation.
                        console.log(`[roo-lay] Starting new task for channel ${channelId} as previous task may have ended.`);
                        try {
                            const newTaskId = await this.rooCodeApi.startNewTask({ text: content });
                            activeTaskIds.set(channelId, newTaskId);
                            channelIdByTaskId.set(newTaskId, channelId);
                            vscode.window.showInformationMessage(`New task ${newTaskId} started from channel ${channelId}`);
                        } catch (startError) {
                            console.error('Failed to start new task after sendMessage failed:', startError);
                        }
                    }
                } else {
                    console.log(`[roo-lay] No active task for channel ${channelId}, starting new task.`);
                    try {
                        const newTaskId = await this.rooCodeApi.startNewTask({ text: content });
                        activeTaskIds.set(channelId, newTaskId);
                        channelIdByTaskId.set(newTaskId, channelId);
                        vscode.window.showInformationMessage(`New task ${newTaskId} started from channel ${channelId}`);
                    } catch (error) {
                        console.error('Failed to start new task:', error);
                    }
                }
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