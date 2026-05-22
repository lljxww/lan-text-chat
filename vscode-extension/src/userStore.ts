import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';
import { User, UsersFile } from './types';
import { atomicWriteJson, formatError, isNodeError, safeJsonParse } from './utils';

export class UserStore {
  private readonly filePath: string;
  private users: User[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(storageUri: vscode.Uri, private readonly output: vscode.OutputChannel) {
    this.filePath = path.join(storageUri.fsPath, 'users.json');
  }

  public async load(): Promise<User[]> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = safeJsonParse(raw, isUsersFile);
      if (!parsed) {
        throw new Error('users.json schema is invalid.');
      }
      this.users = parsed.users;
    } catch (error) {
      if (!(isNodeError(error) && error.code === 'ENOENT')) {
        this.output.appendLine(`Failed to load users cache: ${formatError(error)}`);
      }
      this.users = [];
    }
    return this.getAll();
  }

  public getAll(): User[] {
    return [...this.users].sort((a, b) => a.username.localeCompare(b.username));
  }

  public async replace(users: User[]): Promise<void> {
    const incomingIds = new Set(users.map(user => user.userId));
    const retainedOffline = this.users
      .filter(user => !incomingIds.has(user.userId))
      .map(user => ({ ...user, online: false }));
    this.users = mergeUsers(retainedOffline, users);
    await this.persist();
  }

  public async upsert(user: User): Promise<void> {
    this.users = mergeUsers(this.users, [user]);
    await this.persist();
  }

  public async setOffline(userId: string, lastSeenAt: string): Promise<void> {
    const user = this.users.find(item => item.userId === userId);
    if (user) {
      user.online = false;
      user.lastSeenAt = lastSeenAt;
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    const snapshot: UsersFile = { version: 1, users: this.users };
    this.writeQueue = this.writeQueue
      .catch(error => this.output.appendLine(`Previous users write failed: ${formatError(error)}`))
      .then(() => atomicWriteJson(this.filePath, snapshot));
    await this.writeQueue;
  }
}

function mergeUsers(existing: User[], incoming: User[]): User[] {
  const byId = new Map(existing.map(user => [user.userId, user]));
  for (const user of incoming) {
    byId.set(user.userId, { ...byId.get(user.userId), ...user });
  }
  return [...byId.values()];
}

function isUsersFile(value: unknown): value is UsersFile {
  const file = value as Partial<UsersFile>;
  return !!file && file.version === 1 && Array.isArray(file.users);
}
