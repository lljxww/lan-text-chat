import WebSocket from 'ws';
import { ClientToServerMessage, ConnectionState, LanTextChatConfig, SendResult, ServerToClientMessage } from './types';
import { formatError, nowIso } from './utils';

type MessageHandler = (message: ServerToClientMessage) => void;
type StateHandler = (state: ConnectionState, error?: string) => void;

const heartbeatIntervalMs = 15000;
const heartbeatTimeoutMs = 45000;

export class ChatClient implements DisposableLike {
  private socket?: WebSocket;
  private config?: LanTextChatConfig;
  private state: ConnectionState = 'disconnected';
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private helloTimer?: NodeJS.Timeout;
  private lastPongAt = 0;
  private manualDisconnect = false;
  private disposed = false;

  constructor(
    private readonly output: { appendLine(value: string): void },
    private readonly onMessage: MessageHandler,
    private readonly onStateChange: StateHandler
  ) {}

  public configure(config: LanTextChatConfig): void {
    this.config = config;
  }

  public connect(config = this.config): void {
    this.config = config;
    if (!config) {
      this.setState('error', 'Missing chat client configuration.');
      return;
    }
    if (config.offlineMode) {
      this.disconnect(true);
      this.setState('offline');
      return;
    }
    if (!config.serverUrl.trim()) {
      this.setState('error', 'lanTextChat.serverUrl is empty.');
      return;
    }
    if (this.socket && (this.state === 'connecting' || this.state === 'connected' || this.state === 'reconnecting')) {
      return;
    }

    let url: URL;
    try {
      url = new URL(config.serverUrl);
      if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
        throw new Error('serverUrl must use ws:// or wss://.');
      }
    } catch (error) {
      this.setState('error', `Invalid serverUrl: ${formatError(error)}`);
      return;
    }

    this.manualDisconnect = false;
    this.clearReconnectTimer();
    this.closeSocket();
    this.setState(this.state === 'reconnecting' ? 'reconnecting' : 'connecting');

    const socket = new WebSocket(url);
    this.socket = socket;
    this.lastPongAt = Date.now();

    socket.on('open', () => {
      this.output.appendLine(`Connected to Rust chat server at ${config.serverUrl}.`);
      this.sendHello(config);
      this.startHeartbeat();
    });

    socket.on('message', data => this.handleRawMessage(data));

    socket.on('error', error => {
      const message = formatError(error);
      this.output.appendLine(`WebSocket error: ${message}`);
      this.setState('error', message);
    });

    socket.on('close', () => {
      this.clearHeartbeat();
      this.clearHelloTimer();
      this.closeSocket();
      if (this.disposed || this.manualDisconnect) {
        this.setState(config.offlineMode ? 'offline' : 'disconnected');
        return;
      }
      this.setState(config.autoReconnect ? 'reconnecting' : 'disconnected');
      if (config.autoReconnect) {
        this.scheduleReconnect();
      }
    });
  }

  public disconnect(offline = false): void {
    this.manualDisconnect = true;
    this.clearReconnectTimer();
    this.clearHeartbeat();
    this.clearHelloTimer();
    this.closeSocket();
    this.setState(offline ? 'offline' : 'disconnected');
  }

  public reconnect(): void {
    if (!this.config) {
      return;
    }
    this.manualDisconnect = false;
    this.setState('reconnecting');
    this.connect(this.config);
  }

  public send(message: ClientToServerMessage): SendResult {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || this.state !== 'connected') {
      return { ok: false, error: 'Not connected to Rust chat server.' };
    }
    try {
      this.socket.send(JSON.stringify(message));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public dispose(): void {
    this.disposed = true;
    this.disconnect();
  }

  private sendHello(config: LanTextChatConfig): void {
    const result = this.rawSend({
      type: 'hello',
      clientId: config.userId,
      username: config.username,
      clientType: 'vscode-extension',
      protocolVersion: 1,
      timestamp: nowIso()
    });
    if (!result.ok) {
      this.setState('error', result.error);
      return;
    }
    this.helloTimer = setTimeout(() => {
      if (this.state !== 'connected') {
        this.output.appendLine('Timed out waiting for hello-ack.');
        this.socket?.close();
      }
    }, 10000);
  }

  private rawSend(message: ClientToServerMessage): SendResult {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return { ok: false, error: 'WebSocket is not open.' };
    }
    try {
      this.socket.send(JSON.stringify(message));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  }

  private handleRawMessage(data: WebSocket.RawData): void {
    const raw = data.toString('utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.output.appendLine(`Ignored malformed WebSocket message: ${formatError(error)}`);
      return;
    }
    if (!isServerToClientMessage(parsed)) {
      this.output.appendLine(`Ignored unknown server message: ${raw.slice(0, 200)}`);
      return;
    }
    if (parsed.type === 'hello-ack') {
      this.clearHelloTimer();
      this.setState('connected');
    }
    if (parsed.type === 'pong') {
      this.lastPongAt = Date.now();
    }
    this.onMessage(parsed);
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastPongAt > heartbeatTimeoutMs) {
        this.output.appendLine('Heartbeat timed out; reconnecting.');
        this.socket?.close();
        return;
      }
      this.rawSend({ type: 'ping', timestamp: nowIso() });
    }, heartbeatIntervalMs);
  }

  private scheduleReconnect(): void {
    if (!this.config || this.reconnectTimer || this.disposed || this.config.offlineMode || !this.config.autoReconnect) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect(this.config);
    }, this.config.reconnectIntervalMs);
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
      socket.close();
    }
  }

  private setState(state: ConnectionState, error?: string): void {
    if (this.state === state && !error) {
      return;
    }
    this.state = state;
    this.onStateChange(state, error);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private clearHelloTimer(): void {
    if (this.helloTimer) {
      clearTimeout(this.helloTimer);
      this.helloTimer = undefined;
    }
  }
}

interface DisposableLike {
  dispose(): void;
}

function isServerToClientMessage(value: unknown): value is ServerToClientMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const message = value as Partial<ServerToClientMessage>;
  return typeof message.type === 'string'
    && [
      'hello-ack',
      'direct-message',
      'group-message',
      'group-created',
      'group-updated',
      'group-deleted',
      'user-online',
      'user-offline',
      'read-receipt',
      'error',
      'pong',
      'server-sync'
    ].includes(message.type);
}
