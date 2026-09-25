import { navigate } from '../../lib/router';
import { questionProgress } from '../../lib/stats';
import { useSession } from '../../store/session';
import type { ContentFile, Question, QuestionState, SessionConfig } from '../../types';

export const QUEST_GOAL = 20;

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const BASE: Omit<SessionConfig, 'scopeKind' | 'selectedKeys' | 'count' | 'order'> = {
  timerEnabled: true,
  timerSeconds: 120,
  trapOnly: false,
  wrongFirst: false,
  skipDrops: false,
};

function launch(config: SessionConfig, queue: string[]) {
  if (queue.length === 0) return;
  // start() returns false when the user keeps a session already in progress.
  if (!useSession.getState().start(config, queue)) return;
  navigate('/session');
}

export function subjectKeys(questions: Question[]): string[] {
  return [...new Set(questions.map((q) => q.subject))];
}

/** Last-answered-wrong first, then never attempted, then the rest; each group shuffled. */
export function startQuest(subjectQuestions: Question[], states: Record<string, QuestionState>) {
  const wrong: string[] = [];
  const fresh: string[] = [];
  const rest: string[] = [];
  for (const q of subjectQuestions) {
    const p = questionProgress(states[q.id]);
    (p === 'wrong' ? wrong : p === 'new' ? fresh : rest).push(q.id);
  }
  const queue = [...shuffle(wrong), ...shuffle(fresh), ...shuffle(rest)].slice(0, QUEST_GOAL);
  launch(
    { ...BASE, scopeKind: 'subject', selectedKeys: subjectKeys(subjectQuestions), count: QUEST_GOAL, order: 'sequential', mode: 'quest' },
    queue,
  );
}

export function startRandomDrill(subjectQuestions: Question[]) {
  launch(
    { ...BASE, scopeKind: 'subject', selectedKeys: subjectKeys(subjectQuestions), count: 20, order: 'random', mode: 'drill' },
    shuffle(subjectQuestions.map((q) => q.id)).slice(0, 20),
  );
}

export function startLoDrill(key: string, questionIds: string[]) {
  launch({ ...BASE, scopeKind: 'lo', selectedKeys: [key], count: 'all', order: 'shuffled', mode: 'drill' }, shuffle(questionIds));
}

export function startTopicDrill(key: string, questionIds: string[]) {
  launch({ ...BASE, scopeKind: 'topic', selectedKeys: [key], count: 20, order: 'shuffled', mode: 'drill' }, shuffle(questionIds).slice(0, 20));
}

export function startSubjectQuick(subject: string, file: ContentFile) {
  launch(
    { ...BASE, scopeKind: 'subject', selectedKeys: [subject], count: 20, order: 'shuffled', mode: 'drill' },
    shuffle(file.questionIds).slice(0, 20),
  );
}

export function startMock(file: ContentFile) {
  launch({ ...BASE, scopeKind: 'subject', selectedKeys: [file.name], count: 'all', order: 'sequential', mode: 'mock' }, [...file.questionIds]);
}
