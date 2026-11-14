import { useEffect, useRef, useState } from 'react';
import { subscribe, subscribeEvents, getState } from '../store.js';

/** The latest /state, when it arrived (for the countdown), and the last fetch error. */
export function useStore() {
  const [st, set] = useState(() => ({ s: getState(), at: Date.now(), error: null }));
  useEffect(() => subscribe((s, error) => set(prev => (s && !error ? { s, at: Date.now(), error: null } : { ...prev, error: error || 'no state' }))), []);
  return st;
}

/** Call `fn` with every SSE message. */
export function useEvents(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => subscribeEvents(m => ref.current(m)), []);
}
