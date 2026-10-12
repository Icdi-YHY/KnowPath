import Dexie, { type Table } from 'dexie';
import type {
  ChatMessage,
  CrossLink,
  KnowledgeBase,
  Settings,
  ThreadNode,
} from '@/types';

interface Kv {
  key: string;
  value: unknown;
}

class KnowPathDB extends Dexie {
  kbs!: Table<KnowledgeBase, string>;
  nodes!: Table<ThreadNode, string>;
  crossLinks!: Table<CrossLink, string>;
  messages!: Table<ChatMessage, string>;
  kv!: Table<Kv, string>;

  constructor() {
    super('knowpath');
    this.version(1).stores({
      kbs: 'id, updatedAt',
      nodes: 'id, kbId, parentId, kind, order',
      crossLinks: 'id, kbId, sourceId, targetId',
      messages: 'id, kbId, nodeId, createdAt',
      kv: 'key',
    });
  }
}

export const db = new KnowPathDB();

export async function getSettings(): Promise<Partial<Settings>> {
  const row = await db.kv.get('settings');
  return (row?.value as Partial<Settings>) ?? {};
}

export async function saveSettings(s: Settings): Promise<void> {
  await db.kv.put({ key: 'settings', value: s });
}

export async function getActiveKbId(): Promise<string | null> {
  const row = await db.kv.get('activeKbId');
  return (row?.value as string) ?? null;
}

export async function setActiveKbId(id: string | null): Promise<void> {
  await db.kv.put({ key: 'activeKbId', value: id });
}
