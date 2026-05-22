import { DisplayLanguage } from './types';

type TranslationKey =
  | 'chatView.title'
  | 'command.send.title'
  | 'command.send.promptWithServer'
  | 'notification.openChat'
  | 'notification.incoming';

const translations: Record<DisplayLanguage, Record<TranslationKey, string>> = {
  'zh-cn': {
    'chatView.title': '局域网聊天',
    'command.send.title': '局域网聊天：发送消息',
    'command.send.promptWithServer': '通过服务器 {serverUrl} 发送消息',
    'notification.openChat': '打开聊天',
    'notification.incoming': '来自 {sender} 的局域网消息：{text}'
  },
  en: {
    'chatView.title': 'LAN Chat',
    'command.send.title': 'LAN Chat: Send Message',
    'command.send.promptWithServer': 'Send through server {serverUrl}',
    'notification.openChat': 'Open Chat',
    'notification.incoming': 'LAN Chat from {sender}: {text}'
  }
};

export function t(language: DisplayLanguage, key: TranslationKey, values: Record<string, string | number> = {}): string {
  let value = translations[language][key];
  for (const [name, replacement] of Object.entries(values)) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}
