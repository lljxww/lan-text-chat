export type DisplayLanguage = 'zh-cn' | 'en';
export type SendShortcut = 'enter' | 'ctrlEnter';
export type ConversationType = 'direct' | 'group';
export type MessageDirection = 'incoming' | 'outgoing';
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'error';

export interface LanTextChatConfig {
  serverUrl: string;
  username: string;
  userId: string;
  offlineMode: boolean;
  enableReadReceipts: boolean;
  autoReconnect: boolean;
  reconnectIntervalMs: number;
  enableNotifications: boolean;
  language: DisplayLanguage;
  sendShortcut: SendShortcut;
  maxSavedMessages: number;
}

export interface User {
  userId: string;
  username: string;
  online: boolean;
  lastSeenAt?: string;
  ipAddress?: string;
}

export interface Group {
  id: string;
  name: string;
  ownerUserId?: string;
  members: User[];
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  title: string;
  targetUserId?: string;
  groupId?: string;
  unreadCount: number;
  updatedAt: string;
  lastMessagePreview?: string;
}

export interface ReadByEntry {
  userId: string;
  username: string;
  timestamp: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  conversationType: ConversationType;
  direction: MessageDirection;
  fromUserId: string;
  fromUsername: string;
  toUserId?: string;
  groupId?: string;
  text: string;
  timestamp: string;
  status: MessageStatus;
  readBy?: ReadByEntry[];
  errorMessage?: string;
}

export interface HelloMessage {
  type: 'hello';
  clientId: string;
  username: string;
  clientType: 'vscode-extension';
  protocolVersion: 1;
  timestamp: string;
}

export interface ClientDirectMessage {
  type: 'direct-message';
  id: string;
  fromUserId: string;
  toUserId: string;
  text: string;
  timestamp: string;
}

export interface ClientGroupMessage {
  type: 'group-message';
  id: string;
  groupId: string;
  fromUserId: string;
  text: string;
  timestamp: string;
}

export interface CreateGroupMessage {
  type: 'create-group';
  requestId: string;
  name: string;
  memberUserIds: string[];
}

export interface UpdateGroupMessage {
  type: 'update-group';
  requestId: string;
  groupId: string;
  name?: string;
  memberUserIds?: string[];
  addMemberUserIds?: string[];
  removeMemberUserIds?: string[];
}

export interface DeleteGroupMessage {
  type: 'delete-group';
  requestId: string;
  groupId: string;
}

export interface JoinGroupMessage {
  type: 'join-group';
  requestId: string;
  groupId: string;
}

export interface LeaveGroupMessage {
  type: 'leave-group';
  requestId: string;
  groupId: string;
}

export interface ReadReceiptMessage {
  type: 'read-receipt';
  messageId: string;
  conversationType: ConversationType;
  conversationId: string;
  readerUserId: string;
  readerUsername: string;
  timestamp: string;
}

export interface TypingMessage {
  type: 'typing';
  conversationType: ConversationType;
  conversationId: string;
  fromUserId: string;
  timestamp: string;
}

export interface PingMessage {
  type: 'ping';
  timestamp: string;
}

export type ClientToServerMessage =
  | HelloMessage
  | ClientDirectMessage
  | ClientGroupMessage
  | CreateGroupMessage
  | UpdateGroupMessage
  | DeleteGroupMessage
  | JoinGroupMessage
  | LeaveGroupMessage
  | ReadReceiptMessage
  | TypingMessage
  | PingMessage;

export interface HelloAckMessage {
  type: 'hello-ack';
  clientId: string;
  serverTime: string;
  onlineUsers: User[];
  groups?: Group[];
  conversations?: Conversation[];
}

export interface ServerDirectMessage {
  type: 'direct-message';
  id: string;
  fromUserId: string;
  fromUsername: string;
  toUserId: string;
  text: string;
  timestamp: string;
}

export interface ServerGroupMessage {
  type: 'group-message';
  id: string;
  groupId: string;
  groupName?: string;
  fromUserId: string;
  fromUsername: string;
  text: string;
  timestamp: string;
}

export interface GroupCreatedMessage {
  type: 'group-created';
  requestId?: string;
  group: Group;
}

export interface GroupUpdatedMessage {
  type: 'group-updated';
  requestId?: string;
  group: Group;
}

export interface GroupDeletedMessage {
  type: 'group-deleted';
  requestId?: string;
  groupId: string;
}

export interface UserOnlineMessage {
  type: 'user-online';
  user: User;
}

export interface UserOfflineMessage {
  type: 'user-offline';
  userId: string;
  lastSeenAt: string;
}

export interface ServerSyncMessage {
  type: 'server-sync';
  users?: User[];
  groups?: Group[];
  conversations?: Conversation[];
}

export interface ServerErrorMessage {
  type: 'error';
  requestId?: string;
  code?: string;
  message: string;
}

export interface PongMessage {
  type: 'pong';
  timestamp: string;
}

export type ServerToClientMessage =
  | HelloAckMessage
  | ServerDirectMessage
  | ServerGroupMessage
  | GroupCreatedMessage
  | GroupUpdatedMessage
  | GroupDeletedMessage
  | UserOnlineMessage
  | UserOfflineMessage
  | ReadReceiptMessage
  | ServerErrorMessage
  | PongMessage
  | ServerSyncMessage;

export interface SendResult {
  ok: boolean;
  error?: string;
}

export interface HistoryFile {
  version: 2;
  messages: ChatMessage[];
  conversations: Conversation[];
}

export interface MessagesFile {
  version: 2;
  messages: ChatMessage[];
}

export interface ConversationsFile {
  version: 2;
  conversations: Conversation[];
}

export interface GroupsFile {
  version: 1;
  groups: Group[];
}

export interface UsersFile {
  version: 1;
  users: User[];
}

export interface ChatViewState {
  config: LanTextChatConfig;
  connection: {
    state: ConnectionState;
    serverUrl: string;
    error?: string;
  };
  currentUser: User;
  users: User[];
  groups: Group[];
  conversations: Conversation[];
  messages: ChatMessage[];
  activeConversationId?: string;
}
