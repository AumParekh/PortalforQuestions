import { useSyncExternalStore } from 'react';

// Hash routing so deep links work on GitHub Pages without a 404 fallback.
// Mock exams take a slug and sub-view: /mock/<slug>[/exam | /results/<id>[/<n>]] (mock/model.ts builds them).
export type Route =
  | '/'
  | '/setup'
  | '/session'
  | '/summary'
  | '/review'
  | '/truefalse'
  | '/formulas'
  | '/sense'
  | '/analytics'
  | '/settings'
  | '/games'
  | '/dev/longest'
  | `/mock/${string}`;

function current(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h.split('?')[0] || '/';
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useRoute(): string {
  return useSyncExternalStore(subscribe, current);
}

export function navigate(route: Route) {
  window.location.hash = route;
}
