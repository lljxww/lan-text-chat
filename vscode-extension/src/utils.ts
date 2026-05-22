import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

export function uuid(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function safeJsonParse<T>(raw: string, guard: (value: unknown) => value is T): T | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return guard(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function htmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function debounce<T extends (...args: never[]) => void>(fn: T, delayMs: number): T {
  let timer: NodeJS.Timeout | undefined;
  return ((...args: Parameters<T>) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), delayMs);
  }) as T;
}

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tempPath, filePath);
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export function truncatePreview(text: string, max = 120): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}
