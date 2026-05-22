import * as vscode from 'vscode';
import { affectsLanTextChatConfig, getConfig, getOrCreateUserId, setOfflineMode, updateConfig } from './config';
import { ChatClient } from './chatClient';
import { ChatService } from './chatService';
import { ChatViewProvider } from './chatViewProvider';
import { GroupStore } from './groupStore';
import { HistoryStore } from './historyStore';
import { UserStore } from './userStore';
import { LanTextChatConfig } from './types';
import { formatError } from './utils';

let service: ChatService | undefined;
const firstRunPromptStateKey = 'lanTextChat.firstRunPromptShown';
const deploymentGuideUrl = 'https://github.com/lljxww/lan-text-chat#deploy-the-rust-server';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('LAN Text Chat');
  context.subscriptions.push(output);
  output.appendLine('LAN Text Chat activating in Rust server mode.');

  let config = await loadRuntimeConfig(context);
  const client = new ChatClient(
    output,
    message => {
      void service?.handleServerMessage(message);
    },
    (state, error) => service?.setConnectionState(state, error)
  );
  const historyStore = new HistoryStore(context.globalStorageUri, output, config.maxSavedMessages);
  const groupStore = new GroupStore(context.globalStorageUri, output);
  const userStore = new UserStore(context.globalStorageUri, output);
  service = new ChatService(config, output, client, historyStore, groupStore, userStore);
  await service.initialize();

  const viewProvider = new ChatViewProvider(
    context.extensionUri,
    service,
    output,
    {
      updateSettings: async values => {
        await updateConfig(values);
      },
      toggleOfflineMode: async () => {
        await setOfflineMode(!getConfig().offlineMode);
      },
      openJsonSettings: async () => {
        await openJsonSettings(output);
      }
    }
  );

  context.subscriptions.push(
    service,
    viewProvider,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, viewProvider),
    vscode.commands.registerCommand('lanTextChat.connectServer', () => service?.connect()),
    vscode.commands.registerCommand('lanTextChat.disconnectServer', () => service?.disconnect()),
    vscode.commands.registerCommand('lanTextChat.toggleOfflineMode', async () => {
      await setOfflineMode(!getConfig().offlineMode);
    }),
    vscode.commands.registerCommand('lanTextChat.sendDirectMessage', async () => {
      await sendDirectMessageCommand();
    }),
    vscode.commands.registerCommand('lanTextChat.createGroup', () => service?.createGroup()),
    vscode.commands.registerCommand('lanTextChat.renameGroup', () => service?.renameGroup()),
    vscode.commands.registerCommand('lanTextChat.inviteUserToGroup', () => service?.inviteUserToGroup()),
    vscode.commands.registerCommand('lanTextChat.leaveGroup', () => service?.leaveGroup()),
    vscode.commands.registerCommand('lanTextChat.deleteGroup', () => service?.deleteGroup()),
    vscode.commands.registerCommand('lanTextChat.clearLocalHistory', () => service?.clearLocalHistory()),
    vscode.commands.registerCommand('lanTextChat.openChatView', async () => {
      await openChatView(output);
    }),
    vscode.workspace.onDidChangeConfiguration(async event => {
      if (!affectsLanTextChatConfig(event)) {
        return;
      }
      config = await loadRuntimeConfig(context);
      output.appendLine('LAN Text Chat configuration changed.');
      await historyStore.setMaxMessages(config.maxSavedMessages);
      await service?.updateConfig(config);
    })
  );

  await showFirstRunPrompt(context, output);

  async function sendDirectMessageCommand(): Promise<void> {
    const state = service?.getState();
    if (!state) {
      return;
    }
    const pick = await vscode.window.showQuickPick(
      state.users
        .filter(user => user.online && user.userId !== state.currentUser.userId)
        .map(user => ({ label: user.username, description: user.ipAddress ? `${user.ipAddress} | ${user.userId}` : user.userId, userId: user.userId })),
      { title: 'LAN Chat: Send Direct Message', ignoreFocusOut: true }
    );
    if (!pick) {
      return;
    }
    const text = await vscode.window.showInputBox({ title: `Message to ${pick.label}`, prompt: 'Message text', ignoreFocusOut: true });
    if (text?.trim()) {
      await service?.startDirectConversation(pick.userId);
      await service?.sendDirectMessage(pick.userId, text.trim());
    }
  }
}

export async function deactivate(): Promise<void> {
  service?.dispose();
  service = undefined;
}

async function loadRuntimeConfig(context: vscode.ExtensionContext): Promise<LanTextChatConfig> {
  const config = getConfig();
  const userId = await getOrCreateUserId(context, config);
  return { ...config, userId };
}

async function openChatView(output: vscode.OutputChannel): Promise<void> {
  try {
    await vscode.commands.executeCommand('lanTextChat.chatView.focus');
  } catch (error) {
    output.appendLine(`Failed to focus LAN Chat view: ${formatError(error)}`);
    await vscode.commands.executeCommand('workbench.view.extension.lanTextChat');
  }
}

async function openJsonSettings(output: vscode.OutputChannel): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.action.openSettingsJson', {
      revealSetting: { key: 'lanTextChat.serverUrl', edit: true }
    });
  } catch (error) {
    output.appendLine(`Failed to open settings JSON: ${formatError(error)}`);
    await vscode.commands.executeCommand('workbench.action.openSettingsJson');
  }
}

async function showFirstRunPrompt(context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<void> {
  if (context.globalState.get<boolean>(firstRunPromptStateKey)) {
    return;
  }

  await context.globalState.update(firstRunPromptStateKey, true);
  const configureAction = '打开设置';
  const readmeAction = '查看部署说明';
  const message = 'LAN Text Chat 默认连接 ws://127.0.0.1:38991/ws。如果 Rust 后端运行在其他机器，请先配置 lanTextChat.serverUrl。';
  const action = await vscode.window.showInformationMessage(message, configureAction, readmeAction);

  if (action === configureAction) {
    await openJsonSettings(output);
  } else if (action === readmeAction) {
    await vscode.env.openExternal(vscode.Uri.parse(deploymentGuideUrl));
  }
}
