import { create } from 'zustand';
import type { ContentFile, Question } from '../types';

interface RawContentFile {
  type: 'subject' | 'mock';
  name: string;
  tiers?: string[];
  timeLimitMinutes?: number;
  questions: Omit<Question, 'file'>[];
}

interface ContentState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  files: ContentFile[];
  questions: Question[];
  byId: Record<string, Question>;
  load: () => Promise<void>;
}

// Subjects first in a stable order, then mocks alphabetically.
const SUBJECT_ORDER = ['IR.json', 'MR.json', 'CR.json', 'LR.json', 'OR.json', 'CI.json'];

function sortPaths(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const ia = SUBJECT_ORDER.indexOf(a);
    const ib = SUBJECT_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });
}

export const useContent = create<ContentState>((set, get) => ({
  status: 'idle',
  error: null,
  files: [],
  questions: [],
  byId: {},
  load: async () => {
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading', error: null });
    try {
      const manifest: string[] = await fetch('/content/manifest.json').then((r) => {
        if (!r.ok) throw new Error(`manifest: HTTP ${r.status}`);
        return r.json();
      });
      const raws = await Promise.all(
        sortPaths(manifest).map(async (path) => {
          const r = await fetch(`/content/${path}`);
          if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
          return { path, raw: (await r.json()) as RawContentFile };
        }),
      );
      const files: ContentFile[] = [];
      const questions: Question[] = [];
      for (const { path, raw } of raws) {
        const qs = raw.questions.map((q) => ({ ...q, subject: q.subject || raw.name, file: path }) as Question);
        questions.push(...qs);
        files.push({
          path,
          type: raw.type,
          name: raw.name,
          tiers: raw.tiers,
          timeLimitMinutes: raw.timeLimitMinutes,
          questionIds: qs.map((q) => q.id),
        });
      }
      const byId: Record<string, Question> = {};
      for (const q of questions) byId[q.id] = q;
      set({ status: 'ready', files, questions, byId });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
