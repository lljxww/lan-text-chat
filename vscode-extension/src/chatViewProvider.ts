import * as vscode from 'vscode';
import { ChatService } from './chatService';
import { ChatViewState, LanTextChatConfig } from './types';
import { formatError } from './utils';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'open-conversation'; conversationId: string }
  | { type: 'start-direct'; userId: string }
  | { type: 'open-group'; groupId: string }
  | { type: 'send'; text: string }
  | { type: 'create-group'; name: string; memberUserIds: string[] }
  | { type: 'rename-group'; groupId: string; name: string }
  | { type: 'invite-users'; groupId: string; userIds: string[] }
  | { type: 'leave-group'; groupId: string }
  | { type: 'delete-group'; groupId: string }
  | { type: 'clear-history' }
  | { type: 'connect' }
  | { type: 'disconnect' }
  | { type: 'open-json-settings' }
  | { type: 'toggle-offline' }
  | { type: 'update-settings'; values: Partial<LanTextChatConfig> };

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'lanTextChat.chatView';

  private view?: vscode.WebviewView;
  private state?: ChatViewState;
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly service: ChatService,
    private readonly output: vscode.OutputChannel,
    private readonly callbacks: {
      updateSettings(values: Partial<LanTextChatConfig>): Promise<void>;
      toggleOfflineMode(): Promise<void>;
      openJsonSettings(): Promise<void>;
    }
  ) {
    this.subscription = service.onDidChange(state => {
      this.state = state;
      this.postState();
    });
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(message => {
      void this.handleWebviewMessage(message as WebviewMessage);
    });
    this.postState();
  }

  public dispose(): void {
    this.subscription.dispose();
  }

  private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          this.postState();
          break;
        case 'open-conversation':
          await this.service.openConversation(message.conversationId);
          break;
        case 'start-direct':
          await this.service.startDirectConversation(message.userId);
          break;
        case 'open-group':
          await this.service.openGroup(message.groupId);
          break;
        case 'send':
          await this.service.sendMessage(message.text);
          break;
        case 'create-group':
          await this.service.createGroup(message.name, message.memberUserIds);
          break;
        case 'rename-group':
          await this.service.renameGroup(message.groupId, message.name);
          break;
        case 'invite-users':
          await this.service.inviteUserToGroup(message.groupId, message.userIds);
          break;
        case 'leave-group':
          await this.service.leaveGroup(message.groupId);
          break;
        case 'delete-group':
          await this.service.deleteGroup(message.groupId);
          break;
        case 'clear-history':
          await this.service.clearLocalHistory();
          break;
        case 'connect':
          this.service.connect();
          break;
        case 'disconnect':
          this.service.disconnect();
          break;
        case 'open-json-settings':
          await this.callbacks.openJsonSettings();
          break;
        case 'toggle-offline':
          await this.callbacks.toggleOfflineMode();
          break;
        case 'update-settings':
          await this.callbacks.updateSettings(message.values);
          break;
      }
    } catch (error) {
      this.output.appendLine(`Webview action failed: ${formatError(error)}`);
    }
  }

  private postState(): void {
    if (this.state) {
      void this.view?.webview.postMessage({ type: 'state', state: this.state });
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="zh-cn">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LAN Text Chat</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    body { display: grid; grid-template-rows: auto minmax(0, 1fr); margin: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
    button, input, textarea, select { font: inherit; }
    button { border: 0; border-radius: 2px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); padding: 4px 8px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    input, textarea, select { width: 100%; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 5px; }
    label.check { display: inline-flex; gap: 5px; align-items: center; color: var(--vscode-foreground); font-size: 12px; }
    label.check input { width: auto; }
    .top { display: grid; gap: 6px; padding: 8px; border-bottom: 1px solid var(--vscode-sideBar-border); background: var(--vscode-editor-background); }
    .status { display: flex; gap: 6px; align-items: center; min-width: 0; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-descriptionForeground); flex: 0 0 auto; }
    .dot.connected { background: var(--vscode-charts-green); }
    .dot.connecting, .dot.reconnecting { background: var(--vscode-charts-yellow); }
    .dot.error, .dot.offline { background: var(--vscode-errorForeground); }
    .status-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); }
    .actions, .inline { display: flex; gap: 5px; flex-wrap: wrap; }
    .settings, .panel { display: none; gap: 6px; padding-top: 6px; }
    .settings.active, .panel.active { display: grid; }
    .field label, .section-title { display: block; margin-bottom: 4px; color: var(--vscode-descriptionForeground); font-size: 11px; text-transform: uppercase; }
    .layout { display: grid; grid-template-columns: minmax(128px, 36%) minmax(0, 1fr); min-height: 0; height: 100%; overflow: hidden; }
    .sidebar { border-right: 1px solid var(--vscode-sideBar-border); overflow: auto; }
    .section { padding: 8px; border-bottom: 1px solid var(--vscode-sideBar-border); }
    .item { width: 100%; display: grid; gap: 2px; padding: 6px; margin-bottom: 4px; text-align: left; border-radius: 4px; color: var(--vscode-foreground); background: transparent; border: 1px solid transparent; }
    .item:hover, .item.active { background: var(--vscode-list-hoverBackground); border-color: var(--vscode-sideBar-border); }
    .item-main { display: flex; gap: 5px; justify-content: space-between; min-width: 0; }
    .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge { min-width: 18px; border-radius: 9px; padding: 0 5px; text-align: center; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 11px; }
    .sub { color: var(--vscode-descriptionForeground); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chat { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; overflow: hidden; }
    .chat-head { padding: 8px; border-bottom: 1px solid var(--vscode-sideBar-border); display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
    .chat-title { flex: 1; min-width: 100px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .group-panel { padding: 8px; border-bottom: 1px solid var(--vscode-sideBar-border); background: var(--vscode-editor-background); }
    .member-list { display: grid; gap: 3px; max-height: 120px; overflow: auto; padding: 4px 0; }
    .messages { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 8px; overscroll-behavior: contain; }
    .message { max-width: 92%; margin: 0 0 8px; padding: 7px; border: 1px solid var(--vscode-sideBar-border); border-radius: 6px; background: var(--vscode-editor-background); }
    .message.outgoing { margin-left: auto; border-right: 3px solid var(--vscode-charts-blue); }
    .message.incoming { border-left: 3px solid var(--vscode-charts-green); }
    .meta { color: var(--vscode-descriptionForeground); font-size: 11px; margin-bottom: 4px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .status-icon { display: inline-flex; min-width: 16px; justify-content: center; color: var(--vscode-descriptionForeground); font-size: 13px; }
    .status-icon.sent, .status-icon.read { color: var(--vscode-charts-green); }
    .status-icon.pending { color: var(--vscode-charts-yellow); }
    .status-icon.failed { color: var(--vscode-errorForeground); }
    .read-count { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .text { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; }
    .composer { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; flex: 0 0 auto; gap: 6px; padding: 8px; border-top: 1px solid var(--vscode-sideBar-border); background: var(--vscode-sideBar-background); }
    .composer textarea { min-height: 48px; max-height: 120px; resize: vertical; }
    .composer button { align-self: end; height: 32px; min-width: 56px; }
    .empty { color: var(--vscode-descriptionForeground); padding: 8px 0; }
    @media (max-width: 420px) { .layout { grid-template-columns: 1fr; grid-template-rows: minmax(96px, 30vh) minmax(0, 1fr); height: 100%; } .sidebar { max-height: none; border-right: 0; border-bottom: 1px solid var(--vscode-sideBar-border); } .chat { min-height: 0; height: 100%; } }
  </style>
</head>
<body>
  <header class="top">
    <div class="status"><span id="statusDot" class="dot"></span><span id="statusText" class="status-text"></span></div>
    <div class="actions">
      <button id="connect" type="button"></button>
      <button id="disconnect" class="secondary" type="button"></button>
      <button id="settingsToggle" class="secondary" type="button"></button>
    </div>
    <form id="settings" class="settings">
      <div class="field"><label id="usernameLabel"></label><input id="username" type="text"></div>
      <div class="field"><label id="serverUrlLabel"></label><input id="serverUrl" type="text"></div>
      <div class="field"><label id="maxSavedMessagesLabel"></label><input id="maxSavedMessages" type="number" min="1" step="1"></div>
      <div class="field"><label id="languageLabel"></label><select id="language"><option value="zh-cn">简体中文</option><option value="en">English</option></select></div>
      <div class="inline">
        <label class="check"><input id="offlineMode" type="checkbox"><span id="offlineModeLabel"></span></label>
        <label class="check"><input id="readReceipts" type="checkbox"><span id="readReceiptsLabel"></span></label>
        <label class="check"><input id="notifications" type="checkbox"><span id="notificationsLabel"></span></label>
        <label class="check"><input id="autoReconnect" type="checkbox"><span id="autoReconnectLabel"></span></label>
      </div>
      <div class="inline">
        <select id="sendShortcut"><option value="enter"></option><option value="ctrlEnter"></option></select>
        <button id="saveSettings" type="submit"></button>
        <button id="editJsonSettings" class="secondary" type="button"></button>
      </div>
    </form>
  </header>
  <main class="layout">
    <aside class="sidebar">
      <section class="section"><div id="conversationsTitle" class="section-title"></div><div id="conversations"></div></section>
      <section class="section"><div id="usersTitle" class="section-title"></div><input id="userSearch" type="search"><div id="users"></div></section>
      <section class="section">
        <div id="groupsTitle" class="section-title"></div>
        <button id="createGroupToggle" type="button"></button>
        <form id="createGroupPanel" class="panel">
          <input id="createGroupName" type="text">
          <div id="createGroupMembers" class="member-list"></div>
          <div class="inline"><button id="createGroupSubmit" type="submit"></button><button id="createGroupCancel" class="secondary" type="button"></button></div>
        </form>
        <div id="groups"></div>
      </section>
      <section class="section"><button id="clearHistory" class="secondary" type="button"></button></section>
    </aside>
    <section class="chat">
      <div class="chat-head">
        <div id="chatTitle" class="chat-title"></div>
        <button id="renameGroup" class="secondary" type="button"></button>
        <button id="inviteUsers" class="secondary" type="button"></button>
        <button id="leaveGroup" class="secondary" type="button"></button>
        <button id="deleteGroup" class="secondary" type="button"></button>
      </div>
      <form id="renamePanel" class="panel group-panel"><input id="renameInput" type="text"><div class="inline"><button id="renameSubmit" type="submit"></button><button id="renameCancel" class="secondary" type="button"></button></div></form>
      <form id="invitePanel" class="panel group-panel"><div id="inviteMembers" class="member-list"></div><div class="inline"><button id="inviteSubmit" type="submit"></button><button id="inviteCancel" class="secondary" type="button"></button></div></form>
      <div id="messages" class="messages"></div>
      <form id="composer" class="composer"><textarea id="text"></textarea><button id="sendButton" type="submit"></button></form>
    </section>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let state;
    const el = id => document.getElementById(id);
    const conversationsEl = el('conversations'), usersEl = el('users'), groupsEl = el('groups'), messagesEl = el('messages');
    const textEl = el('text'), settingsEl = el('settings');
    const createGroupPanelEl = el('createGroupPanel'), renamePanelEl = el('renamePanel'), invitePanelEl = el('invitePanel');
    const labels = {
      'zh-cn': {
        connect: '连接', disconnect: '断开', settings: '设置', username: '用户名',
        serverUrl: '服务器地址', language: '语言', offlineMode: '离线模式',
        readReceipts: '已读回执', notifications: '启用 VS Code 通知', autoReconnect: '自动重连', maxSavedMessages: '最大保存消息条数', save: '保存', editJson: '编辑 JSON',
        enterSends: 'Enter 发送', ctrlEnterSends: 'Ctrl+Enter 发送', conversations: '会话',
        onlineUsers: '在线用户', userSearch: '搜索在线用户', groups: '群聊', createGroup: '创建群聊', groupName: '群聊名称',
        create: '创建', cancel: '取消', clearHistory: '清空本地历史', selectConversation: '选择一个会话',
        rename: '改名', invite: '邀请', leave: '退出', delete: '删除', newGroupName: '新的群聊名称',
        send: '发送', message: '输入消息', noConversations: '暂无会话', noUsers: '暂无在线用户',
        noGroups: '暂无群聊', noMessages: '暂无消息', noIp: '未知 IP', members: '个成员', status: {
          disconnected: '未连接', connecting: '连接中', connected: '已连接', reconnecting: '重连中', offline: '离线', error: '错误',
          pending: '发送中', sent: '已发送', delivered: '已送达', read: '已读', failed: '发送失败', incomingUnread: '未读'
        }
      },
      en: {
        connect: 'Connect', disconnect: 'Disconnect', settings: 'Settings', username: 'Username',
        serverUrl: 'Server URL', language: 'Language', offlineMode: 'Offline',
        readReceipts: 'Read receipts', notifications: 'Enable VS Code notifications', autoReconnect: 'Auto reconnect', maxSavedMessages: 'Max saved messages', save: 'Save', editJson: 'Edit JSON',
        enterSends: 'Enter sends', ctrlEnterSends: 'Ctrl+Enter sends', conversations: 'Conversations',
        onlineUsers: 'Online Users', userSearch: 'Search online users', groups: 'Groups', createGroup: 'Create Group', groupName: 'Group name',
        create: 'Create', cancel: 'Cancel', clearHistory: 'Clear Local History', selectConversation: 'Select a conversation',
        rename: 'Rename', invite: 'Invite', leave: 'Leave', delete: 'Delete', newGroupName: 'New group name',
        send: 'Send', message: 'Message', noConversations: 'No conversations', noUsers: 'No online users',
        noGroups: 'No groups', noMessages: 'No messages yet', noIp: 'Unknown IP', members: ' members', status: {
          disconnected: 'Disconnected', connecting: 'Connecting', connected: 'Connected', reconnecting: 'Reconnecting', offline: 'Offline', error: 'Error',
          pending: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed', incomingUnread: 'Unread'
        }
      }
    };

    window.addEventListener('message', event => {
      if (event.data?.type === 'state') { state = event.data.state; render(); }
    });
    el('connect').onclick = () => vscode.postMessage({ type: 'connect' });
    el('disconnect').onclick = () => vscode.postMessage({ type: 'disconnect' });
    el('settingsToggle').onclick = () => settingsEl.classList.toggle('active');
    el('editJsonSettings').onclick = () => vscode.postMessage({ type: 'open-json-settings' });
    el('userSearch').oninput = () => renderUsers(currentLabels());
    el('clearHistory').onclick = () => vscode.postMessage({ type: 'clear-history' });
    el('createGroupToggle').onclick = () => togglePanel(createGroupPanelEl);
    el('createGroupCancel').onclick = () => closePanel(createGroupPanelEl);
    el('renameGroup').onclick = () => { el('renameInput').value = activeConversation()?.title || ''; togglePanel(renamePanelEl); closePanel(invitePanelEl); };
    el('renameCancel').onclick = () => closePanel(renamePanelEl);
    el('inviteUsers').onclick = () => { renderMemberChecks(el('inviteMembers'), 'invite-user'); togglePanel(invitePanelEl); closePanel(renamePanelEl); };
    el('inviteCancel').onclick = () => closePanel(invitePanelEl);
    el('leaveGroup').onclick = () => groupAction('leave-group');
    el('deleteGroup').onclick = () => groupAction('delete-group');
    el('composer').onsubmit = event => {
      event.preventDefault();
      const text = textEl.value.trim();
      if (text) { vscode.postMessage({ type: 'send', text }); textEl.value = ''; }
    };
    textEl.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      const shortcut = state?.config?.sendShortcut === 'ctrlEnter' ? 'ctrlEnter' : 'enter';
      const modified = event.ctrlKey || event.metaKey;
      if ((shortcut === 'enter' && !event.shiftKey && !modified) || (shortcut === 'ctrlEnter' && modified)) {
        event.preventDefault();
        el('composer').requestSubmit();
      }
    });
    settingsEl.onsubmit = event => {
      event.preventDefault();
      vscode.postMessage({ type: 'update-settings', values: {
        username: el('username').value.trim(),
        serverUrl: el('serverUrl').value.trim(),
        language: el('language').value === 'en' ? 'en' : 'zh-cn',
        offlineMode: el('offlineMode').checked,
        enableReadReceipts: el('readReceipts').checked,
        enableNotifications: el('notifications').checked,
        autoReconnect: el('autoReconnect').checked,
        sendShortcut: el('sendShortcut').value === 'ctrlEnter' ? 'ctrlEnter' : 'enter',
        maxSavedMessages: Math.max(1, Math.floor(Number(el('maxSavedMessages').value) || 1000))
      }});
      settingsEl.classList.remove('active');
    };
    el('createGroupPanel').onsubmit = event => {
      event.preventDefault();
      const name = el('createGroupName').value.trim();
      if (!name) return;
      vscode.postMessage({ type: 'create-group', name, memberUserIds: checkedValues('create-group-user') });
      el('createGroupName').value = '';
      closePanel(createGroupPanelEl);
    };
    el('renamePanel').onsubmit = event => {
      event.preventDefault();
      const groupId = activeGroupId();
      const name = el('renameInput').value.trim();
      if (groupId && name) vscode.postMessage({ type: 'rename-group', groupId, name });
      closePanel(renamePanelEl);
    };
    el('invitePanel').onsubmit = event => {
      event.preventDefault();
      const groupId = activeGroupId();
      if (groupId) vscode.postMessage({ type: 'invite-users', groupId, userIds: checkedValues('invite-user') });
      closePanel(invitePanelEl);
    };

    function render() {
      const l = currentLabels();
      document.documentElement.lang = state.config.language === 'en' ? 'en' : 'zh-cn';
      renderLabels(l);
      const status = state.connection.state;
      el('statusDot').className = 'dot ' + status;
      el('statusText').textContent = l.status[status] + ' | ' + state.connection.serverUrl + ' | ' + state.config.username;
      const canDisconnect = status === 'connected' || status === 'connecting' || status === 'reconnecting';
      el('connect').style.display = canDisconnect ? 'none' : '';
      el('disconnect').style.display = canDisconnect ? '' : 'none';
      setInputValue(el('username'), state.config.username || '');
      setInputValue(el('serverUrl'), state.config.serverUrl || '');
      setInputValue(el('maxSavedMessages'), String(state.config.maxSavedMessages || 1000));
      setInputValue(el('language'), state.config.language === 'en' ? 'en' : 'zh-cn');
      el('offlineMode').checked = Boolean(state.config.offlineMode);
      el('readReceipts').checked = Boolean(state.config.enableReadReceipts);
      el('notifications').checked = state.config.enableNotifications !== false;
      el('autoReconnect').checked = Boolean(state.config.autoReconnect);
      el('sendShortcut').value = state.config.sendShortcut === 'ctrlEnter' ? 'ctrlEnter' : 'enter';
      renderConversations(l);
      renderUsers(l);
      renderGroups(l);
      renderMemberChecks(el('createGroupMembers'), 'create-group-user');
      renderMessages(l);
    }
    function renderLabels(l) {
      el('connect').textContent = l.connect; el('disconnect').textContent = l.disconnect;
      el('settingsToggle').textContent = l.settings; el('usernameLabel').textContent = l.username; el('serverUrlLabel').textContent = l.serverUrl;
      el('maxSavedMessagesLabel').textContent = l.maxSavedMessages; el('languageLabel').textContent = l.language; el('offlineModeLabel').textContent = l.offlineMode;
      el('readReceiptsLabel').textContent = l.readReceipts; el('notificationsLabel').textContent = l.notifications; el('autoReconnectLabel').textContent = l.autoReconnect;
      el('sendShortcut').options[0].textContent = l.enterSends; el('sendShortcut').options[1].textContent = l.ctrlEnterSends; el('saveSettings').textContent = l.save; el('editJsonSettings').textContent = l.editJson;
      el('conversationsTitle').textContent = l.conversations; el('usersTitle').textContent = l.onlineUsers; el('groupsTitle').textContent = l.groups;
      el('userSearch').placeholder = l.userSearch;
      el('createGroupToggle').textContent = l.createGroup; el('createGroupName').placeholder = l.groupName; el('createGroupSubmit').textContent = l.create;
      el('createGroupCancel').textContent = l.cancel; el('clearHistory').textContent = l.clearHistory; el('chatTitle').textContent = activeConversation()?.title || l.selectConversation;
      el('renameGroup').textContent = l.rename; el('inviteUsers').textContent = l.invite; el('leaveGroup').textContent = l.leave; el('deleteGroup').textContent = l.delete;
      el('renameInput').placeholder = l.newGroupName; el('renameSubmit').textContent = l.rename; el('renameCancel').textContent = l.cancel;
      el('inviteSubmit').textContent = l.invite; el('inviteCancel').textContent = l.cancel; textEl.placeholder = l.message; el('sendButton').textContent = l.send;
    }
    function renderConversations(l) {
      conversationsEl.replaceChildren();
      if (!state.conversations.length) return conversationsEl.append(empty(l.noConversations));
      for (const conversation of state.conversations) {
        const item = buttonItem(conversation.title, conversation.lastMessagePreview || conversation.type, conversation.unreadCount);
        if (conversation.id === state.activeConversationId) item.classList.add('active');
        item.onclick = () => vscode.postMessage({ type: 'open-conversation', conversationId: conversation.id });
        conversationsEl.append(item);
      }
    }
    function renderUsers(l) {
      usersEl.replaceChildren();
      const query = el('userSearch').value.trim().toLowerCase();
      const users = state.users
        .filter(user => user.online && user.userId !== state.currentUser.userId)
        .filter(user => !query || user.username.toLowerCase().includes(query) || (user.ipAddress || '').toLowerCase().includes(query));
      if (!users.length) return usersEl.append(empty(l.noUsers));
      for (const user of users) {
        const item = buttonItem(user.username, user.ipAddress || l.noIp, 0);
        item.title = user.ipAddress ? user.ipAddress + ' | ' + user.userId : user.userId;
        item.onclick = () => {
          if (user.userId !== state.currentUser.userId) {
            vscode.postMessage({ type: 'start-direct', userId: user.userId });
          }
        };
        usersEl.append(item);
      }
    }
    function renderGroups(l) {
      groupsEl.replaceChildren();
      if (!state.groups.length) return groupsEl.append(empty(l.noGroups));
      for (const group of state.groups) {
        const item = buttonItem(group.name, group.members.length + l.members, 0);
        item.onclick = () => vscode.postMessage({ type: 'open-group', groupId: group.id });
        groupsEl.append(item);
      }
    }
    function renderMessages(l) {
      const active = activeConversation();
      el('chatTitle').textContent = active ? active.title : l.selectConversation;
      const isGroup = active?.type === 'group';
      for (const id of ['renameGroup','inviteUsers','leaveGroup','deleteGroup']) el(id).style.display = isGroup ? '' : 'none';
      messagesEl.replaceChildren();
      const messages = state.messages.filter(message => message.conversationId === state.activeConversationId);
      if (!messages.length) return messagesEl.append(empty(active ? l.noMessages : l.selectConversation));
      for (const message of messages) {
        const root = document.createElement('article');
        root.className = 'message ' + message.direction;
        const meta = document.createElement('div');
        meta.className = 'meta';
        const sender = document.createElement('span');
        sender.textContent = message.fromUsername;
        const time = document.createElement('span');
        time.textContent = formatTime(message.timestamp);
        meta.append(sender, time, statusNode(message, l));
        const text = document.createElement('div');
        text.className = 'text';
        text.textContent = message.text;
        root.append(meta, text);
        messagesEl.append(root);
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    function statusNode(message, l) {
      const wrap = document.createElement('span');
      wrap.className = 'inline';
      const icon = document.createElement('span');
      const status = message.direction === 'incoming' && message.status !== 'read' ? 'incomingUnread' : message.status;
      const info = iconFor(status);
      icon.className = 'status-icon ' + status;
      icon.textContent = info.glyph;
      icon.title = l.status[status] || status;
      wrap.append(icon);
      if (message.conversationType === 'group' && message.direction === 'outgoing') {
        const group = state.groups.find(g => g.id === message.groupId);
        const total = group ? Math.max(group.members.length - 1, 0) : 0;
        const count = document.createElement('span');
        count.className = 'read-count';
        count.textContent = String((message.readBy || []).length) + '/' + String(total);
        count.title = l.status.read;
        wrap.append(count);
      }
      return wrap;
    }
    function iconFor(status) {
      if (status === 'pending') return { glyph: '◷' };
      if (status === 'sent') return { glyph: '✓' };
      if (status === 'delivered') return { glyph: '✓✓' };
      if (status === 'read') return { glyph: '●' };
      if (status === 'failed') return { glyph: '!' };
      return { glyph: '○' };
    }
    function renderMemberChecks(container, name) {
      container.replaceChildren();
      const users = state?.users?.filter(user => user.userId !== state.currentUser.userId) || [];
      if (!users.length) return container.append(empty(currentLabels().noUsers));
      for (const user of users) {
        const label = document.createElement('label');
        label.className = 'check';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = name;
        input.value = user.userId;
        const text = document.createElement('span');
        text.textContent = user.ipAddress ? user.username + ' (' + user.ipAddress + ')' : user.username;
        label.append(input, text);
        container.append(label);
      }
    }
    function buttonItem(title, sub, count) {
      const root = document.createElement('button');
      root.type = 'button';
      root.className = 'item';
      const main = document.createElement('div');
      main.className = 'item-main';
      const titleEl = document.createElement('span');
      titleEl.className = 'title';
      titleEl.textContent = title;
      main.append(titleEl);
      if (count > 0) { const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = String(count); main.append(badge); }
      const subEl = document.createElement('div');
      subEl.className = 'sub';
      subEl.textContent = sub;
      root.append(main, subEl);
      return root;
    }
    function empty(text) { const node = document.createElement('div'); node.className = 'empty'; node.textContent = text; return node; }
    function setInputValue(input, value) { if (document.activeElement !== input) input.value = value; }
    function checkedValues(name) { return Array.from(document.querySelectorAll('input[name="' + name + '"]:checked')).map(input => input.value); }
    function activeConversation() { return state?.conversations?.find(c => c.id === state.activeConversationId); }
    function activeGroupId() { return activeConversation()?.type === 'group' ? activeConversation().groupId : undefined; }
    function groupAction(type) { const groupId = activeGroupId(); if (groupId) vscode.postMessage({ type, groupId }); }
    function togglePanel(panel) { panel.classList.toggle('active'); }
    function closePanel(panel) { panel.classList.remove('active'); }
    function currentLabels() { return labels[state?.config?.language === 'en' ? 'en' : 'zh-cn']; }
    function formatTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
