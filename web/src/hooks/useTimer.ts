import { useEffect, useRef, useState } from 'react';

interface TimerResult {
  remaining: number;
  elapsed: number;
}

/**
 * Per-key countdown. Elapsed time is remembered per key, so leaving a question and
 * coming back resumes it instead of restarting. Pauses while `running` is false and
 * calls `onExpire` at most once per key.
 */
export function useTimer(durationSeconds: number, running: boolean, key: string, onExpire: () => void): TimerResult {
  const elapsedMs = useRef(new Map<string, number>());
  const firedRef = useRef(new Set<string>());
  const onExpireRef = useRef(onExpire);
  const [tick, setTick] = useState<{ key: string; elapsed: number }>({ key, elapsed: 0 });

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (!running || firedRef.current.has(key)) return;

    const totalMs = durationSeconds * 1000;
    const base = elapsedMs.current.get(key) ?? 0;
    const startedAt = Date.now();
    let id: number | undefined;

    const update = () => {
      const ms = Math.min(totalMs, base + (Date.now() - startedAt));
      elapsedMs.current.set(key, ms);
      const secs = Math.floor(ms / 1000);
      setTick((prev) => (prev.key === key && prev.elapsed === secs ? prev : { key, elapsed: secs }));
      if (ms >= totalMs && !firedRef.current.has(key)) {
        firedRef.current.add(key);
        if (id !== undefined) window.clearInterval(id);
        id = undefined;
        onExpireRef.current();
      }
    };

    id = window.setInterval(update, 250);
    return () => {
      if (id !== undefined) window.clearInterval(id);
    };
  }, [durationSeconds, running, key]);

  // Before the first tick for a newly shown key, fall back to what was already accumulated for it.
  const elapsed = tick.key === key ? tick.elapsed : Math.floor((elapsedMs.current.get(key) ?? 0) / 1000);
  return { elapsed, remaining: Math.max(0, durationSeconds - elapsed) };
}
