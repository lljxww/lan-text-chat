import * as vscode from 'vscode';
import { userInfo } from 'os';
import { DisplayLanguage, LanTextChatConfig, SendShortcut } from './types';
import { uuid } from './utils';

const sectionName = 'lanTextChat';
const userIdStateKey = 'lanTextChat.userId';
const defaultServerUrl = 'ws://127.0.0.1:38991/ws';

export function getConfig(): LanTextChatConfig {
  const config = vscode.workspace.getConfiguration(sectionName);
  return {
    serverUrl: normalizeUrl(config.get<string>('serverUrl', defaultServerUrl), defaultServerUrl),
    username: normalizeUsername(config.get<string>('username', '')),
    userId: config.get<string>('userId', '').trim(),
    offlineMode: config.get<boolean>('offlineMode', false),
    enableReadReceipts: config.get<boolean>('enableReadReceipts', true),
    autoReconnect: config.get<boolean>('autoReconnect', true),
    reconnectIntervalMs: normalizeReconnectInterval(config.get<number>('reconnectIntervalMs', 3000)),
    enableNotifications: config.get<boolean>('enableNotifications', true),
    language: normalizeLanguage(config.get<string>('language', 'zh-cn')),
    sendShortcut: normalizeSendShortcut(config.get<string>('sendShortcut', 'enter')),
    maxSavedMessages: normalizeMaxSavedMessages(config.get<number>('maxSavedMessages', 1000))
  };
}

export async function getOrCreateUserId(context: vscode.ExtensionContext, config: LanTextChatConfig): Promise<string> {
  if (config.userId) {
    return config.userId;
  }

  const existing = context.globalState.get<string>(userIdStateKey);
  if (existing) {
    return existing;
  }

  const created = uuid();
  await context.globalState.update(userIdStateKey, created);
  return created;
}

export function affectsLanTextChatConfig(event: vscode.ConfigurationChangeEvent): boolean {
  return event.affectsConfiguration(sectionName);
}

export async function setOfflineMode(value: boolean): Promise<void> {
  await vscode.workspace.getConfiguration(sectionName).update('offlineMode', value, vscode.ConfigurationTarget.Global);
}

export async function updateConfig(values: Partial<LanTextChatConfig>): Promise<void> {
  const config = vscode.workspace.getConfiguration(sectionName);
  const allowed: Array<keyof LanTextChatConfig> = [
    'serverUrl',
    'username',
    'userId',
    'offlineMode',
    'enableReadReceipts',
    'autoReconnect',
    'reconnectIntervalMs',
    'enableNotifications',
    'language',
    'sendShortcut',
    'maxSavedMessages'
  ];

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      await config.update(key, values[key], getUpdateTarget(config, key));
    }
  }
}

function getUpdateTarget(config: vscode.WorkspaceConfiguration, key: keyof LanTextChatConfig): vscode.ConfigurationTarget {
  const inspected = config.inspect(key);
  return inspected?.workspaceValue !== undefined
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

function normalizeUsername(value: string): string {
  const trimmed = value.trim();
  if (trimmed && trimmed !== 'VSCode User') {
    return trimmed;
  }

  try {
    const osUsername = userInfo().username.trim();
    return osUsername || 'VSCode User';
  } catch {
    return 'VSCode User';
  }
}

function normalizeUrl(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeReconnectInterval(value: number): number {
  return Number.isFinite(value) && value >= 500 ? Math.floor(value) : 3000;
}

function normalizeMaxSavedMessages(value: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1000;
}

function normalizeLanguage(value: string): DisplayLanguage {
  return value.toLowerCase() === 'en' ? 'en' : 'zh-cn';
}

function normalizeSendShortcut(value: string): SendShortcut {
  return value === 'ctrlEnter' ? 'ctrlEnter' : 'enter';
}
