import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import * as WebSocket from 'ws';
import { createHash } from 'crypto';

// --- Type Definitions ---
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
                choices?: { label: string; value: string; }[];
            };
        },
    ];
    taskCreated: [string];
    taskStarted: [string];
    taskAborted: [string];
    taskCompleted: [string, any];
};

export enum RooCodeEventName {
    Message = "message",
    TaskCreated = "taskCreated",
    TaskStarted = "taskStarted",
    TaskAborted = "taskAborted",
    TaskCompleted = "taskCompleted",
}

interface RooCodeAPI extends EventEmitter<RooCodeEvents> {
    startNewTask(options: { text?: string }): Promise<string>;
    sendMessage(text?: string): Promise<void>;
    cancelCurrentTask(): Promise<void>;
}

// --- WebSocket and State Configuration ---
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 30000;

class GlobalState {
    activeTaskIds = new Map<string, string>();
    channelIdByTaskId = new Map<string, string>();
    wsClientInstance: WebSocketClient | null = null;
    reconnectTimeout: NodeJS.Timeout | null = null;
    reconnectDelay = RECONNECT_DELAY_MS;
    isExtensionActive = true;
    clientId: string | undefined;
}
const globalState = new GlobalState();

// --- Helper Functions ---
function getRooCodeApi(): RooCodeAPI | undefined {
    const extension = vscode.extensions.getExtension<RooCodeAPI>("rooveterinaryinc.roo-cline");
    if (!extension) {
        vscode.window.showErrorMessage("Roo Code extension not found.");
        return undefined;
    }
    if (!extension.isActive) extension.activate();
    return extension.exports;
}

// --- WebSocket Client ---
class WebSocketClient {
    private ws: WebSocket.WebSocket | null = null;
    private rooCodeApi: RooCodeAPI | undefined;
    private isLeader = false;

    constructor() {
        this.rooCodeApi = getRooCodeApi();
        this.setupRooCodeEventListeners();
    }

    private setupRooCodeEventListeners(): void {
        if (!this.rooCodeApi) return;

        const eventHandler = (eventName: string) => (taskId: string, data: any = {}) => {
            if (!this.isLeader) return;
            const channelId = globalState.channelIdByTaskId.get(taskId);
            if (channelId) {
                this.sendToDiscord({ type: 'event', eventName, channelId, data: { taskId, ...data } });
            }
        };

        this.rooCodeApi.on(RooCodeEventName.Message, (event) => {
            if (!this.isLeader) return;
            const channelId = globalState.channelIdByTaskId.get(event.taskId);
            if (channelId) {
                this.sendToDiscord({ type: 'event', eventName: 'message', channelId, data: event });
            }
        });
        
        this.rooCodeApi.on(RooCodeEventName.TaskStarted, eventHandler('taskStarted'));
        this.rooCodeApi.on(RooCodeEventName.TaskCompleted, eventHandler('taskCompleted'));

        this.rooCodeApi.on(RooCodeEventName.TaskAborted, (taskId) => {
            if (!this.isLeader) return;
            const channelId = globalState.channelIdByTaskId.get(taskId);
            if (channelId) {
                this.sendToDiscord({ type: 'event', eventName: 'taskAborted', channelId, data: { taskId } });
                globalState.activeTaskIds.delete(channelId);
                globalState.channelIdByTaskId.delete(taskId);
            }
        });

    }

    public connect(): void {
        if (!globalState.isExtensionActive || this.ws) return;

        const configuration = vscode.workspace.getConfiguration('roo-lay');
        const port = configuration.get<number>('websocket.port');

        if (!port) {
            vscode.window.setStatusBarMessage('Roo-Lay: Port not configured.', 10000);
            // We don't treat this as an error, the user may not want it active in this workspace.
            // We will periodically re-check in case the setting is added.
            this.scheduleReconnect();
            return;
        }

        try {
            if (!globalState.clientId) {
                globalState.clientId = createHash('sha256').update(Date.now().toString() + Math.random().toString()).digest('hex');
            }
            const urlWithClientId = `ws://localhost:${port}?clientId=${globalState.clientId}`;
            this.ws = new WebSocket.WebSocket(urlWithClientId);

            this.ws.on('open', () => {
                globalState.reconnectDelay = RECONNECT_DELAY_MS;
                if (globalState.reconnectTimeout) clearTimeout(globalState.reconnectTimeout);
            });
            this.ws.on('message', (data) => this.handleWebSocketMessage(data));
            this.ws.on('close', () => this.handleWebSocketClose());
            this.ws.on('error', (error) => {
                vscode.window.setStatusBarMessage('Roo-Lay: Connection Error', 5000);
                console.error('[roo-lay] WebSocket error:', error)
            });

        } catch (error) {
            if (globalState.isExtensionActive) this.scheduleReconnect();
        }
    }

    private handleWebSocketMessage(data: WebSocket.RawData): void {
        const message = JSON.parse(data.toString());
        if (message.type === 'connection') {
            this.isLeader = message.isActive;
            vscode.window.setStatusBarMessage(`Roo-Lay: ${this.isLeader ? 'LEADER' : 'STANDBY'}`, 5000);
        } else if (this.isLeader) {
            this.handleDiscordMessage(message);
        }
    }

    private handleWebSocketClose(): void {
        this.ws = null;
        this.isLeader = false;
        vscode.window.setStatusBarMessage('Roo-Lay: Disconnected', 5000);
        if (globalState.isExtensionActive) this.scheduleReconnect();
    }

    private scheduleReconnect(): void {
        if (globalState.reconnectTimeout) return;
        globalState.reconnectTimeout = setTimeout(() => {
            globalState.reconnectTimeout = null;
            if (globalState.isExtensionActive) {
                this.connect();
                globalState.reconnectDelay = Math.min(globalState.reconnectDelay * 1.5, MAX_RECONNECT_DELAY_MS);
            }
        }, globalState.reconnectDelay);
    }

    private async handleDiscordMessage(message: any): Promise<void> {
        if (!this.rooCodeApi) return;
        const { type, command, content, channelId } = message;
        if (!channelId) return;

        if (type === 'command' && (command === 'reset' || command === 'stop' || command === 'new')) {
            // Acknowledge immediately to prevent Discord timeout
            this.sendToDiscord({ type: 'ack', command: command, channelId });

            try {
                const currentTaskId = globalState.activeTaskIds.get(channelId);
                if (currentTaskId) {
                    await this.rooCodeApi.cancelCurrentTask();
                    // Clear task mappings after cancellation
                    globalState.activeTaskIds.delete(channelId);
                    globalState.channelIdByTaskId.delete(currentTaskId);
                }
            } catch (error) {
                console.error(`[roo-lay] Error during cancelCurrentTask for command '${command}'.`, error);
            }
        } else if (type === 'message' && content) {
            const currentTaskId = globalState.activeTaskIds.get(channelId);
            if (currentTaskId) {
                await this.rooCodeApi.sendMessage(content);
            } else {
                await this.startNewTaskForChannel(channelId, content);
            }
        }
    }

    private async startNewTaskForChannel(channelId: string, text: string): Promise<void> {
        if (!this.rooCodeApi) return;
        try {
            const newTaskId = await this.rooCodeApi.startNewTask({ text });
            globalState.activeTaskIds.set(channelId, newTaskId);
            globalState.channelIdByTaskId.set(newTaskId, channelId);
        } catch (error) {
            console.error('[roo-lay] Failed to start new task:', error);
        }
    }

    private sendToDiscord(data: any): void {
        if (this.ws?.readyState === WebSocket.WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    public isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.WebSocket.OPEN;
    }

    public disconnect(): void {
        globalState.isExtensionActive = false;
        if (globalState.reconnectTimeout) clearTimeout(globalState.reconnectTimeout);
        this.ws?.close();
    }
}

// --- VS Code Extension Activation ---
export function activate(context: vscode.ExtensionContext) {
    globalState.isExtensionActive = true;
    if (!globalState.wsClientInstance) {
        globalState.wsClientInstance = new WebSocketClient();
    }
    globalState.wsClientInstance.connect();

    context.subscriptions.push(new vscode.Disposable(() => {
        globalState.wsClientInstance?.disconnect();
        globalState.wsClientInstance = null;
    }));
}

export function deactivate() {
    globalState.isExtensionActive = false;
    globalState.wsClientInstance?.disconnect();
    globalState.wsClientInstance = null;
}