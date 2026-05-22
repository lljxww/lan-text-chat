import * as vscode from 'vscode';
import { ChatClient } from './chatClient';
import { HistoryStore } from './historyStore';
import { GroupStore } from './groupStore';
import { UserStore } from './userStore';
import {
  ChatMessage,
  ChatViewState,
  ConnectionState,
  Conversation,
  Group,
  LanTextChatConfig,
  ServerToClientMessage,
  User
} from './types';
import { formatError, nowIso, truncatePreview, uuid } from './utils';

export class ChatService implements vscode.Disposable {
  private config: LanTextChatConfig;
  private connectionState: ConnectionState = 'disconnected';
  private connectionError: string | undefined;
  private activeConversationId: string | undefined;
  private listeners: Array<(state: ChatViewState) => void> = [];

  constructor(
    initialConfig: LanTextChatConfig,
    private readonly output: vscode.OutputChannel,
    private readonly client: ChatClient,
    private readonly historyStore: HistoryStore,
    private readonly groupStore: GroupStore,
    private readonly userStore: UserStore
  ) {
    this.config = initialConfig;
  }

  public async initialize(): Promise<void> {
    await this.historyStore.load();
    await this.groupStore.load();
    await this.userStore.load();
    await this.ensureCurrentUser();
    this.client.configure(this.config);
    this.publish();
    if (this.config.offlineMode) {
      this.connectionState = 'offline';
    } else {
      this.client.connect(this.config);
    }
  }

  public onDidChange(listener: (state: ChatViewState) => void): vscode.Disposable {
    this.listeners.push(listener);
    listener(this.getState());
    return new vscode.Disposable(() => {
      this.listeners = this.listeners.filter(item => item !== listener);
    });
  }

  public async updateConfig(config: LanTextChatConfig): Promise<void> {
    const previous = this.config;
    this.config = config;
    await this.ensureCurrentUser();
    this.client.configure(config);
    if (config.offlineMode) {
      this.client.disconnect(true);
      this.connectionState = 'offline';
    } else if (
      previous.serverUrl !== config.serverUrl
      || previous.offlineMode !== config.offlineMode
      || previous.username !== config.username
      || previous.userId !== config.userId
    ) {
      this.client.disconnect();
      this.client.connect(config);
    }
    this.publish();
  }

  public setConnectionState(state: ConnectionState, error?: string): void {
    this.connectionState = state;
    this.connectionError = error;
    this.publish();
  }

  public async handleServerMessage(message: ServerToClientMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'hello-ack':
          await this.userStore.replace(message.onlineUsers.map(user => ({ ...user, online: true })));
          if (message.groups) {
            await this.groupStore.replace(message.groups);
            await this.upsertGroupConversations(message.groups);
          }
          if (message.conversations) {
            await this.historyStore.replaceConversations(message.conversations);
          }
          break;
        case 'server-sync':
          if (message.users) {
            await this.userStore.replace(message.users);
          }
          if (message.groups) {
            await this.groupStore.replace(message.groups);
            await this.upsertGroupConversations(message.groups);
          }
          if (message.conversations) {
            await this.historyStore.replaceConversations(message.conversations);
          }
          break;
        case 'direct-message':
          await this.receiveDirectMessage(message);
          break;
        case 'group-message':
          await this.receiveGroupMessage(message);
          break;
        case 'group-created':
        case 'group-updated':
          await this.groupStore.upsert(message.group);
          await this.upsertGroupConversations([message.group]);
          break;
        case 'group-deleted':
          await this.groupStore.remove(message.groupId);
          break;
        case 'user-online':
          await this.userStore.upsert({ ...message.user, online: true });
          await this.historyStore.updateDirectConversationTitle(message.user.userId, message.user.username);
          break;
        case 'user-offline':
          await this.userStore.setOffline(message.userId, message.lastSeenAt);
          break;
        case 'read-receipt':
          await this.historyStore.addReadReceipt(message.messageId, message.readerUserId, message.readerUsername, message.timestamp);
          break;
        case 'error':
          this.output.appendLine(`Server error${message.code ? ` ${message.code}` : ''}: ${message.message}`);
          void vscode.window.showWarningMessage(message.message);
          break;
        case 'pong':
          break;
      }
    } catch (error) {
      this.output.appendLine(`Failed to handle server message: ${formatError(error)}`);
    } finally {
      this.publish();
    }
  }

  public connect(): void {
    if (this.config.offlineMode) {
      void vscode.window.showWarningMessage(this.text('offlineMode'));
      return;
    }
    this.client.connect(this.config);
  }

  public disconnect(): void {
    this.client.disconnect();
  }

  public async openConversation(conversationId: string): Promise<void> {
    this.activeConversationId = conversationId;
    const readMessages = await this.historyStore.markConversationRead(conversationId);
    if (this.config.enableReadReceipts) {
      for (const message of readMessages) {
        this.sendReadReceipt(message);
      }
    }
    this.publish();
  }

  public async startDirectConversation(userId: string): Promise<void> {
    if (userId === this.config.userId) {
      void vscode.window.showWarningMessage(this.text('cannotMessageSelf'));
      return;
    }
    const user = this.userStore.getAll().find(item => item.userId === userId);
    const conversation: Conversation = {
      id: directConversationId(userId),
      type: 'direct',
      title: user?.username ?? userId,
      targetUserId: userId,
      unreadCount: 0,
      updatedAt: nowIso()
    };
    await this.historyStore.upsertConversation(conversation);
    await this.openConversation(conversation.id);
  }

  public async openGroup(groupId: string): Promise<void> {
    const group = this.groupStore.getAll().find(item => item.id === groupId);
    if (group) {
      await this.historyStore.upsertConversation(groupConversation(group));
      await this.openConversation(group.id);
    }
  }

  public async sendMessage(text: string): Promise<void> {
    const conversation = this.historyStore.getConversations().find(item => item.id === this.activeConversationId);
    if (!conversation) {
      void vscode.window.showWarningMessage(this.text('selectConversation'));
      return;
    }
    if (this.config.offlineMode) {
      void vscode.window.showWarningMessage(this.text('offlineSend'));
      return;
    }

    if (conversation.type === 'direct' && conversation.targetUserId) {
      await this.sendDirectMessage(conversation.targetUserId, text);
    } else if (conversation.type === 'group' && conversation.groupId) {
      await this.sendGroupMessage(conversation.groupId, text);
    }
  }

  public async sendDirectMessage(toUserId: string, text: string): Promise<void> {
    if (toUserId === this.config.userId) {
      void vscode.window.showWarningMessage(this.text('cannotMessageSelf'));
      return;
    }
    const id = uuid();
    const timestamp = nowIso();
    const message: ChatMessage = {
      id,
      conversationId: directConversationId(toUserId),
      conversationType: 'direct',
      direction: 'outgoing',
      fromUserId: this.config.userId,
      fromUsername: this.config.username,
      toUserId,
      text,
      timestamp,
      status: 'pending'
    };
    const result = this.client.send({ type: 'direct-message', id, fromUserId: this.config.userId, toUserId, text, timestamp });
    message.status = result.ok ? 'sent' : 'failed';
    message.errorMessage = result.error;
    await this.historyStore.upsertMessage(message);
    if (!result.ok) {
      void vscode.window.showWarningMessage(result.error ?? this.text('sendFailed'));
    }
    this.publish();
  }

  public async sendGroupMessage(groupId: string, text: string): Promise<void> {
    const id = uuid();
    const timestamp = nowIso();
    const message: ChatMessage = {
      id,
      conversationId: groupId,
      conversationType: 'group',
      direction: 'outgoing',
      fromUserId: this.config.userId,
      fromUsername: this.config.username,
      groupId,
      text,
      timestamp,
      status: 'pending'
    };
    const result = this.client.send({ type: 'group-message', id, groupId, fromUserId: this.config.userId, text, timestamp });
    message.status = result.ok ? 'sent' : 'failed';
    message.errorMessage = result.error;
    await this.historyStore.upsertMessage(message);
    if (!result.ok) {
      void vscode.window.showWarningMessage(result.error ?? this.text('sendFailed'));
    }
    this.publish();
  }

  public async createGroup(name?: string, memberUserIds?: string[]): Promise<void> {
    const groupName = name ?? await vscode.window.showInputBox({ title: this.text('createGroupTitle'), prompt: this.text('groupNamePrompt'), ignoreFocusOut: true });
    if (!groupName?.trim()) {
      return;
    }
    const members = memberUserIds ?? await this.pickUsers('Invite members');
    const result = this.client.send({ type: 'create-group', requestId: uuid(), name: groupName.trim(), memberUserIds: members });
    if (!result.ok) {
      void vscode.window.showWarningMessage(result.error ?? this.text('createGroupFailed'));
    }
  }

  public async renameGroup(groupId?: string, name?: string): Promise<void> {
    const id = groupId ?? await this.pickGroupId(this.text('renameGroupTitle'));
    if (!id) {
      return;
    }
    const nextName = name ?? await vscode.window.showInputBox({ title: this.text('renameGroupTitle'), prompt: this.text('newGroupNamePrompt'), ignoreFocusOut: true });
    if (!nextName?.trim()) {
      return;
    }
    const result = this.client.send({ type: 'update-group', requestId: uuid(), groupId: id, name: nextName.trim() });
    if (!result.ok) {
      void vscode.window.showWarningMessage(result.error ?? this.text('renameGroupFailed'));
    }
  }

  public async inviteUserToGroup(groupId?: string, userIds?: string[]): Promise<void> {
    const id = groupId ?? await this.pickGroupId(this.text('inviteTitle'));
    if (!id) {
      return;
    }
    const members = userIds ?? await this.pickUsers(this.text('inviteMembersTitle'));
    if (!members.length) {
      return;
    }
    const result = this.client.send({ type: 'update-group', requestId: uuid(), groupId: id, addMemberUserIds: members });
    if (!result.ok) {
      void vscode.window.showWarningMessage(result.error ?? this.text('inviteFailed'));
    }
  }

  public async leaveGroup(groupId?: string): Promise<void> {
    const id = groupId ?? await this.pickGroupId(this.text('leaveGroupTitle'));
    if (!id) {
      return;
    }
    const result = this.client.send({ type: 'leave-group', requestId: uuid(), groupId: id });
    if (!result.ok) {
      void vscode.window.showWarningMessage(result.error ?? this.text('leaveGroupFailed'));
    }
  }

  public async deleteGroup(groupId?: string): Promise<void> {
    const id = groupId ?? await this.pickGroupId(this.text('deleteGroupTitle'));
    if (!id) {
      return;
    }
    const result = this.client.send({ type: 'delete-group', requestId: uuid(), groupId: id });
    if (!result.ok) {
      void vscode.window.showWarningMessage(result.error ?? this.text('deleteGroupFailed'));
    }
  }

  public async clearLocalHistory(): Promise<void> {
    await this.historyStore.clear();
    this.activeConversationId = undefined;
    this.publish();
  }

  public getState(): ChatViewState {
    const currentUser: User = {
      userId: this.config.userId,
      username: this.config.username,
      online: this.connectionState === 'connected'
    };
    return {
      config: this.config,
      connection: {
        state: this.config.offlineMode ? 'offline' : this.connectionState,
        serverUrl: this.config.serverUrl,
        error: this.connectionError
      },
      currentUser,
      users: this.visibleUsers(),
      groups: this.groupStore.getAll(),
      conversations: this.historyStore.getConversations(),
      messages: this.historyStore.getMessages(),
      activeConversationId: this.activeConversationId
    };
  }

  public dispose(): void {
    this.client.dispose();
  }

  private async receiveDirectMessage(message: Extract<ServerToClientMessage, { type: 'direct-message' }>): Promise<void> {
    await this.userStore.upsert({ userId: message.fromUserId, username: message.fromUsername, online: true });
    const item: ChatMessage = {
      id: message.id,
      conversationId: directConversationId(message.fromUserId),
      conversationType: 'direct',
      direction: message.fromUserId === this.config.userId ? 'outgoing' : 'incoming',
      fromUserId: message.fromUserId,
      fromUsername: message.fromUsername,
      toUserId: message.toUserId,
      text: message.text,
      timestamp: message.timestamp,
      status: this.activeConversationId === directConversationId(message.fromUserId) ? 'read' : 'delivered'
    };
    await this.historyStore.upsertMessage(item);
    await this.maybeSendImmediateReceipt(item);
    this.notifyIncoming(item);
  }

  private async receiveGroupMessage(message: Extract<ServerToClientMessage, { type: 'group-message' }>): Promise<void> {
    const item: ChatMessage = {
      id: message.id,
      conversationId: message.groupId,
      conversationType: 'group',
      direction: message.fromUserId === this.config.userId ? 'outgoing' : 'incoming',
      fromUserId: message.fromUserId,
      fromUsername: message.fromUsername,
      groupId: message.groupId,
      text: message.text,
      timestamp: message.timestamp,
      status: this.activeConversationId === message.groupId ? 'read' : 'delivered'
    };
    if (message.groupName) {
      await this.historyStore.upsertConversation({
        id: message.groupId,
        type: 'group',
        title: message.groupName,
        groupId: message.groupId,
        unreadCount: 0,
        updatedAt: message.timestamp,
        lastMessagePreview: truncatePreview(message.text)
      });
    }
    await this.historyStore.upsertMessage(item);
    await this.maybeSendImmediateReceipt(item);
    this.notifyIncoming(item);
  }

  private async maybeSendImmediateReceipt(message: ChatMessage): Promise<void> {
    if (message.direction === 'incoming' && this.activeConversationId === message.conversationId && this.config.enableReadReceipts) {
      this.sendReadReceipt(message);
      await this.historyStore.markConversationRead(message.conversationId);
    }
  }

  private sendReadReceipt(message: ChatMessage): void {
    const result = this.client.send({
      type: 'read-receipt',
      messageId: message.id,
      conversationType: message.conversationType,
      conversationId: message.conversationId,
      readerUserId: this.config.userId,
      readerUsername: this.config.username,
      timestamp: nowIso()
    });
    if (!result.ok) {
      this.output.appendLine(`Failed to send read receipt for ${message.id}: ${result.error ?? 'unknown error'}`);
    }
  }

  private notifyIncoming(message: ChatMessage): void {
    if (!this.config.enableNotifications || message.direction !== 'incoming') {
      return;
    }
    const openAction = this.text('openChat');
    void vscode.window.showInformationMessage(this.text('incomingNotification', {
      sender: message.fromUsername,
      text: truncatePreview(message.text)
    }), openAction)
      .then(action => action === openAction ? vscode.commands.executeCommand('lanTextChat.chatView.focus') : undefined);
  }

  private async ensureCurrentUser(): Promise<void> {
    await this.userStore.upsert({
      userId: this.config.userId,
      username: this.config.username,
      online: this.connectionState === 'connected'
    });
  }

  private async upsertGroupConversations(groups: Group[]): Promise<void> {
    for (const group of groups) {
      await this.historyStore.upsertConversation(groupConversation(group));
    }
  }

  private async pickUsers(title: string): Promise<string[]> {
    const picks = await vscode.window.showQuickPick(
      this.userStore.getAll()
        .filter(user => user.userId !== this.config.userId)
        .map(user => ({ label: user.username, description: user.userId, userId: user.userId })),
      { title, canPickMany: true, ignoreFocusOut: true }
    );
    return picks?.map(item => item.userId) ?? [];
  }

  private async pickGroupId(title: string): Promise<string | undefined> {
    const pick = await vscode.window.showQuickPick(
      this.groupStore.getAll().map(group => ({ label: group.name, description: group.id, groupId: group.id })),
      { title, ignoreFocusOut: true }
    );
    return pick?.groupId;
  }

  private publish(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  private visibleUsers(): User[] {
    const currentUserId = this.config.userId.trim();
    return this.userStore.getAll().filter(user => user.userId.trim() !== currentUserId);
  }

  private text(key: TextKey, values: Record<string, string> = {}): string {
    const dictionary = serviceText[this.config.language === 'en' ? 'en' : 'zh-cn'];
    let value = dictionary[key];
    for (const [name, replacement] of Object.entries(values)) {
      value = value.replaceAll(`{${name}}`, replacement);
    }
    return value;
  }
}

type TextKey =
  | 'offlineMode'
  | 'selectConversation'
  | 'offlineSend'
  | 'sendFailed'
  | 'createGroupFailed'
  | 'renameGroupFailed'
  | 'inviteFailed'
  | 'leaveGroupFailed'
  | 'deleteGroupFailed'
  | 'openChat'
  | 'incomingNotification'
  | 'createGroupTitle'
  | 'groupNamePrompt'
  | 'renameGroupTitle'
  | 'newGroupNamePrompt'
  | 'inviteTitle'
  | 'inviteMembersTitle'
  | 'leaveGroupTitle'
  | 'deleteGroupTitle'
  | 'cannotMessageSelf';

const serviceText: Record<'zh-cn' | 'en', Record<TextKey, string>> = {
  'zh-cn': {
    offlineMode: 'LAN Text Chat 当前处于离线模式。',
    selectConversation: '请先选择一个会话。',
    offlineSend: '当前处于离线模式，无法发送消息。',
    sendFailed: '消息发送失败。',
    createGroupFailed: '创建群聊失败。',
    renameGroupFailed: '群聊改名失败。',
    inviteFailed: '邀请成员失败。',
    leaveGroupFailed: '退出群聊失败。',
    deleteGroupFailed: '删除群聊失败。',
    openChat: '打开聊天',
    incomingNotification: '来自 {sender} 的消息：{text}',
    createGroupTitle: 'LAN Chat：创建群聊',
    groupNamePrompt: '群聊名称',
    renameGroupTitle: 'LAN Chat：群聊改名',
    newGroupNamePrompt: '新的群聊名称',
    inviteTitle: 'LAN Chat：邀请成员',
    inviteMembersTitle: '选择要邀请的成员',
    leaveGroupTitle: 'LAN Chat：退出群聊',
    deleteGroupTitle: 'LAN Chat：删除群聊',
    cannotMessageSelf: '不能给自己发送消息。'
  },
  en: {
    offlineMode: 'LAN Text Chat is in offline mode.',
    selectConversation: 'Select a conversation before sending.',
    offlineSend: 'Offline mode is enabled. Messages cannot be sent.',
    sendFailed: 'Message send failed.',
    createGroupFailed: 'Create group failed.',
    renameGroupFailed: 'Rename group failed.',
    inviteFailed: 'Invite failed.',
    leaveGroupFailed: 'Leave group failed.',
    deleteGroupFailed: 'Delete group failed.',
    openChat: 'Open Chat',
    incomingNotification: 'LAN Chat from {sender}: {text}',
    createGroupTitle: 'LAN Chat: Create Group',
    groupNamePrompt: 'Group name',
    renameGroupTitle: 'LAN Chat: Rename Group',
    newGroupNamePrompt: 'New group name',
    inviteTitle: 'LAN Chat: Invite Members',
    inviteMembersTitle: 'Select members to invite',
    leaveGroupTitle: 'LAN Chat: Leave Group',
    deleteGroupTitle: 'LAN Chat: Delete Group',
    cannotMessageSelf: 'You cannot send messages to yourself.'
  }
};

function directConversationId(userId: string): string {
  return `direct:${userId}`;
}

function groupConversation(group: Group): Conversation {
  return {
    id: group.id,
    type: 'group',
    title: group.name,
    groupId: group.id,
    unreadCount: 0,
    updatedAt: group.updatedAt,
    lastMessagePreview: undefined
  };
}
