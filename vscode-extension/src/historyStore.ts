import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';
import { ChatMessage, Conversation, ConversationsFile, HistoryFile, MessagesFile } from './types';
import { atomicWriteJson, formatError, isNodeError, safeJsonParse, truncatePreview } from './utils';

const defaultMaxMessages = 1000;

export class HistoryStore {
  private readonly messagesPath: string;
  private readonly conversationsPath: string;
  private readonly legacyPath: string;
  private messages: ChatMessage[] = [];
  private conversations: Conversation[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(storageUri: vscode.Uri, private readonly output: vscode.OutputChannel, private maxMessages = defaultMaxMessages) {
    this.messagesPath = path.join(storageUri.fsPath, 'messages.json');
    this.conversationsPath = path.join(storageUri.fsPath, 'conversations.json');
    this.legacyPath = path.join(storageUri.fsPath, 'history.json');
    this.maxMessages = normalizeMaxMessages(maxMessages);
  }

  public async load(): Promise<void> {
    this.messages = await this.loadFile(this.messagesPath, isMessagesFile, 'messages', { version: 2, messages: [] }).then(file => file.messages);
    this.conversations = await this.loadFile(this.conversationsPath, isConversationsFile, 'conversations', { version: 2, conversations: [] }).then(file => file.conversations);
    if (!this.messages.length && !this.conversations.length) {
      await this.tryMigrateLegacyHistory();
    }
    const normalized = this.normalizeConversations();
    const trimmed = this.trimMessages();
    this.rebuildMissingConversations();
    if (normalized || trimmed) {
      await this.persist();
    }
  }

  public getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  public getConversations(): Conversation[] {
    return [...this.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  public getMessagesForConversation(conversationId: string): ChatMessage[] {
    return this.messages.filter(message => message.conversationId === conversationId);
  }

  public async upsertMessage(message: ChatMessage): Promise<void> {
    const index = this.messages.findIndex(item => item.id === message.id);
    if (index >= 0) {
      this.messages[index] = { ...this.messages[index], ...message };
    } else {
      this.messages.push(message);
      this.trimMessages();
    }
    this.upsertConversationFromMessage(message);
    await this.persist();
  }

  public async setMaxMessages(maxMessages: number): Promise<void> {
    this.maxMessages = normalizeMaxMessages(maxMessages);
    if (this.trimMessages()) {
      await this.persist();
    }
  }

  public async updateDirectConversationTitle(userId: string, username: string): Promise<void> {
    const conversation = this.conversations.find(item => item.type === 'direct' && item.targetUserId === userId);
    if (!conversation || conversation.title === username) {
      return;
    }
    conversation.title = username;
    await this.persist();
  }

  public async upsertConversation(conversation: Conversation): Promise<void> {
    const normalized = normalizeConversation(conversation);
    const index = this.conversations.findIndex(item => item.id === normalized.id);
    if (index >= 0) {
      this.conversations[index] = { ...this.conversations[index], ...normalized };
    } else {
      this.conversations.push(normalized);
    }
    await this.persist();
  }

  public async replaceConversations(conversations: Conversation[]): Promise<void> {
    const byId = new Map<string, Conversation>();
    for (const conversation of this.conversations) {
      const normalized = normalizeConversation(conversation);
      byId.set(normalized.id, { ...byId.get(normalized.id), ...normalized });
    }
    for (const conversation of conversations) {
      const normalized = normalizeConversation(conversation);
      byId.set(normalized.id, { ...byId.get(normalized.id), ...normalized });
    }
    this.conversations = [...byId.values()];
    await this.persist();
  }

  public async markConversationRead(conversationId: string): Promise<ChatMessage[]> {
    const conversation = this.conversations.find(item => item.id === conversationId);
    if (conversation) {
      conversation.unreadCount = 0;
    }
    const unreadIncoming = this.messages.filter(message =>
      message.conversationId === conversationId
      && message.direction === 'incoming'
      && message.status !== 'read'
    );
    for (const message of unreadIncoming) {
      message.status = 'read';
    }
    await this.persist();
    return unreadIncoming;
  }

  public async addReadReceipt(messageId: string, userId: string, username: string, timestamp: string): Promise<boolean> {
    const message = this.messages.find(item => item.id === messageId);
    if (!message) {
      return false;
    }
    const readBy = message.readBy ?? [];
    if (!readBy.some(item => item.userId === userId)) {
      readBy.push({ userId, username, timestamp });
    }
    message.readBy = readBy;
    if (message.conversationType === 'direct') {
      message.status = 'read';
    }
    await this.persist();
    return true;
  }

  public async updateMessageStatus(id: string, status: ChatMessage['status'], errorMessage?: string): Promise<boolean> {
    const message = this.messages.find(item => item.id === id);
    if (!message) {
      return false;
    }
    message.status = status;
    message.errorMessage = errorMessage;
    await this.persist();
    return true;
  }

  public async clear(): Promise<void> {
    this.messages = [];
    this.conversations = [];
    await this.persist();
  }

  private async persist(): Promise<void> {
    const messagesSnapshot: MessagesFile = { version: 2, messages: this.messages };
    const conversationsSnapshot: ConversationsFile = { version: 2, conversations: this.conversations };
    this.writeQueue = this.writeQueue
      .catch(error => this.output.appendLine(`Previous history write failed: ${formatError(error)}`))
      .then(async () => {
        await atomicWriteJson(this.messagesPath, messagesSnapshot);
        await atomicWriteJson(this.conversationsPath, conversationsSnapshot);
      });
    await this.writeQueue;
  }

  private upsertConversationFromMessage(message: ChatMessage): void {
    const existing = this.conversations.find(item => item.id === message.conversationId);
    const title = message.conversationType === 'direct' && message.direction === 'incoming'
      ? message.fromUsername
      : existing?.title
        ?? (message.conversationType === 'direct'
          ? message.toUserId ?? message.conversationId
          : message.groupId ?? message.conversationId);
    const unreadCount = message.direction === 'incoming' && message.status !== 'read'
      ? (existing?.unreadCount ?? 0) + 1
      : (existing?.unreadCount ?? 0);
    const next: Conversation = {
      id: message.conversationId,
      type: message.conversationType,
      title,
      targetUserId: message.conversationType === 'direct' ? (message.direction === 'incoming' ? message.fromUserId : message.toUserId) : undefined,
      groupId: message.groupId,
      unreadCount,
      updatedAt: message.timestamp,
      lastMessagePreview: truncatePreview(message.text)
    };
    const index = this.conversations.findIndex(item => item.id === next.id);
    if (index >= 0) {
      this.conversations[index] = { ...this.conversations[index], ...next };
    } else {
      this.conversations.push(next);
    }
  }

  private rebuildMissingConversations(): void {
    for (const message of this.messages) {
      if (!this.conversations.some(item => item.id === message.conversationId)) {
        this.upsertConversationFromMessage(message);
      }
    }
  }

  private normalizeConversations(): boolean {
    const before = JSON.stringify(this.conversations);
    const byId = new Map<string, Conversation>();
    for (const conversation of this.conversations) {
      const normalized = normalizeConversation(conversation);
      byId.set(normalized.id, { ...byId.get(normalized.id), ...normalized });
    }
    this.conversations = [...byId.values()];
    return JSON.stringify(this.conversations) !== before;
  }

  private trimMessages(): boolean {
    if (this.messages.length <= this.maxMessages) {
      return false;
    }
    this.messages = this.messages.slice(-this.maxMessages);
    return true;
  }

  private async loadFile<T>(filePath: string, guard: (value: unknown) => value is T, label: string, fallback: T): Promise<T> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = safeJsonParse(raw, guard);
      if (!parsed) {
        throw new Error(`${label} file schema is invalid.`);
      }
      return parsed;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return fallback;
      }
      this.output.appendLine(`Failed to load ${label}: ${formatError(error)}`);
      await backupCorruptFile(filePath, this.output);
      return fallback;
    }
  }

  private async tryMigrateLegacyHistory(): Promise<void> {
    try {
      const raw = await fs.readFile(this.legacyPath, 'utf8');
      const parsed = safeJsonParse(raw, isLegacyHistoryFile);
      if (!parsed) {
        return;
      }
      this.messages = parsed.messages.map(item => {
        const isIncoming = item.direction === 'incoming';
        const otherId = isIncoming ? item.senderClientId : item.targetClientId;
        return {
          id: item.id,
          conversationId: `direct:${otherId}`,
          conversationType: 'direct',
          direction: item.direction,
          fromUserId: isIncoming ? item.senderClientId : 'local-legacy-user',
          fromUsername: item.senderName,
          toUserId: isIncoming ? 'local-legacy-user' : item.targetClientId,
          text: item.text,
          timestamp: item.timestamp,
          status: item.status === 'received' ? 'delivered' : item.status
        };
      });
      this.rebuildMissingConversations();
      await fs.rename(this.legacyPath, `${this.legacyPath}.legacy.backup.json`);
      await this.persist();
      this.output.appendLine('Migrated legacy chat history to server-mode cache files.');
    } catch (error) {
      if (!(isNodeError(error) && error.code === 'ENOENT')) {
        this.output.appendLine(`Legacy history migration failed: ${formatError(error)}`);
      }
    }
  }
}

async function backupCorruptFile(filePath: string, output: vscode.OutputChannel): Promise<void> {
  try {
    await fs.rename(filePath, `${filePath}.corrupt-${Date.now()}`);
  } catch (error) {
    output.appendLine(`Failed to back up corrupt file ${filePath}: ${formatError(error)}`);
  }
}

function isMessagesFile(value: unknown): value is MessagesFile {
  const file = value as Partial<MessagesFile>;
  return !!file && file.version === 2 && Array.isArray(file.messages) && file.messages.every(isChatMessage);
}

function isConversationsFile(value: unknown): value is ConversationsFile {
  const file = value as Partial<ConversationsFile>;
  return !!file && file.version === 2 && Array.isArray(file.conversations) && file.conversations.every(isConversation);
}

function isChatMessage(value: unknown): value is ChatMessage {
  const item = value as Partial<ChatMessage>;
  return !!item
    && typeof item.id === 'string'
    && typeof item.conversationId === 'string'
    && (item.conversationType === 'direct' || item.conversationType === 'group')
    && (item.direction === 'incoming' || item.direction === 'outgoing')
    && typeof item.fromUserId === 'string'
    && typeof item.fromUsername === 'string'
    && typeof item.text === 'string'
    && typeof item.timestamp === 'string';
}

function isConversation(value: unknown): value is Conversation {
  const item = value as Partial<Conversation>;
  return !!item
    && typeof item.id === 'string'
    && (item.type === 'direct' || item.type === 'group')
    && typeof item.title === 'string'
    && typeof item.unreadCount === 'number'
    && typeof item.updatedAt === 'string';
}

interface LegacyHistoryItem {
  id: string;
  direction: 'incoming' | 'outgoing';
  senderName: string;
  senderClientId: string;
  targetClientId: string;
  text: string;
  timestamp: string;
  status: 'sent' | 'received' | 'read' | 'failed';
}

function isLegacyHistoryFile(value: unknown): value is { version: 1; messages: LegacyHistoryItem[] } {
  const file = value as { version?: unknown; messages?: unknown };
  return !!file && file.version === 1 && Array.isArray(file.messages);
}

function normalizeMaxMessages(value: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : defaultMaxMessages;
}

function normalizeConversation(conversation: Conversation): Conversation {
  if (conversation.type === 'direct' && conversation.targetUserId) {
    return { ...conversation, id: `direct:${conversation.targetUserId}` };
  }
  return conversation;
}
