import { useEffect, useState } from 'react';

function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** The current local day; changes when the date rolls over, so "today" stats refresh on long-lived tabs. */
export function useToday(): string {
  const [day, setDay] = useState(dayKey);
  useEffect(() => {
    const refresh = () => setDay((prev) => (prev === dayKey() ? prev : dayKey()));
    const id = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return day;
}
