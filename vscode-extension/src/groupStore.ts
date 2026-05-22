import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Group, GroupsFile } from './types';
import { atomicWriteJson, formatError, isNodeError, safeJsonParse } from './utils';

export class GroupStore {
  private readonly filePath: string;
  private groups: Group[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(storageUri: vscode.Uri, private readonly output: vscode.OutputChannel) {
    this.filePath = path.join(storageUri.fsPath, 'groups.json');
  }

  public async load(): Promise<Group[]> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = safeJsonParse(raw, isGroupsFile);
      if (!parsed) {
        throw new Error('groups.json schema is invalid.');
      }
      this.groups = parsed.groups;
    } catch (error) {
      if (!(isNodeError(error) && error.code === 'ENOENT')) {
        this.output.appendLine(`Failed to load groups cache: ${formatError(error)}`);
      }
      this.groups = [];
    }
    return this.getAll();
  }

  public getAll(): Group[] {
    return [...this.groups].sort((a, b) => a.name.localeCompare(b.name));
  }

  public async replace(groups: Group[]): Promise<void> {
    this.groups = groups;
    await this.persist();
  }

  public async upsert(group: Group): Promise<void> {
    const index = this.groups.findIndex(item => item.id === group.id);
    if (index >= 0) {
      this.groups[index] = group;
    } else {
      this.groups.push(group);
    }
    await this.persist();
  }

  public async remove(groupId: string): Promise<void> {
    this.groups = this.groups.filter(group => group.id !== groupId);
    await this.persist();
  }

  private async persist(): Promise<void> {
    const snapshot: GroupsFile = { version: 1, groups: this.groups };
    this.writeQueue = this.writeQueue
      .catch(error => this.output.appendLine(`Previous groups write failed: ${formatError(error)}`))
      .then(() => atomicWriteJson(this.filePath, snapshot));
    await this.writeQueue;
  }
}

function isGroupsFile(value: unknown): value is GroupsFile {
  const file = value as Partial<GroupsFile>;
  return !!file && file.version === 1 && Array.isArray(file.groups);
}
