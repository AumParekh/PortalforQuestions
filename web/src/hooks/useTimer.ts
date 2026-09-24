import { useEffect, useRef, useState } from 'react';

interface TimerResult {
  remaining: number;
  elapsed: number;
}

/**
 * Per-key countdown. Resets when `key` changes, pauses while `running` is false,
 * and calls `onExpire` at most once per key.
 */
export function useTimer(durationSeconds: number, running: boolean, key: string, onExpire: () => void): TimerResult {
  const [tick, setTick] = useState<{ key: string; elapsed: number }>({ key, elapsed: 0 });
  const accRef = useRef<{ key: string; ms: number }>({ key, ms: 0 });
  const firedRef = useRef<string | null>(null);
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (accRef.current.key !== key) accRef.current = { key, ms: 0 };
    if (!running || firedRef.current === key) return;

    const totalMs = durationSeconds * 1000;
    const base = accRef.current.ms;
    const startedAt = Date.now();
    let id: number | undefined;

    const update = () => {
      const ms = Math.min(totalMs, base + (Date.now() - startedAt));
      accRef.current = { key, ms };
      const secs = Math.floor(ms / 1000);
      setTick((prev) => (prev.key === key && prev.elapsed === secs ? prev : { key, elapsed: secs }));
      if (ms >= totalMs && firedRef.current !== key) {
        firedRef.current = key;
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

  const elapsed = tick.key === key ? tick.elapsed : 0;
  return { elapsed, remaining: Math.max(0, durationSeconds - elapsed) };
}
