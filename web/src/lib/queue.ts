import type { Question, SessionConfig } from '../types';
import { resolveSelection } from './catalog';

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pool(config: SessionConfig, questions: Question[]): string[] {
  const ids = resolveSelection(questions, config.scopeKind, config.selectedKeys);
  if (!config.trapOnly) return ids;
  const byId = new Map(questions.map((q) => [q.id, q]));
  return ids.filter((id) => (byId.get(id)?.trap.operators.length ?? 0) > 0);
}

export function countAvailable(config: SessionConfig, questions: Question[]): number {
  return pool(config, questions).length;
}

export function buildQueue(config: SessionConfig, questions: Question[]): string[] {
  let ids = pool(config, questions);

  switch (config.order) {
    case 'shuffled':
    case 'random':
      ids = shuffle(ids);
      break;
    case 'weakest':
      // Phase 2 will rank by accuracy; no persisted progress yet, so keep source order.
      break;
    case 'sequential':
      break;
  }

  // config.wrongFirst needs persisted progress (Phase 2); no-op for now.

  return config.count === 'all' ? ids : ids.slice(0, Math.max(0, config.count));
}
