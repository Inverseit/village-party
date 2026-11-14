import { useCallback, useEffect, useRef, useState } from 'react';

const store = {
  get(k) { try { return localStorage.getItem('vp.' + k) || ''; } catch { return ''; } },
  set(k, v) { try { v ? localStorage.setItem('vp.' + k, v) : localStorage.removeItem('vp.' + k); } catch { /* private mode */ } },
};

// Resolves to { status, body }; status 0 means the server could not be reached.
async function call(path, body) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(path, { signal: ctrl.signal, cache: 'no-store',
      ...(body && { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    const json = await res.json();
    return { status: res.status, body: json };
  } catch { return { status: 0, body: null }; }
  finally { clearTimeout(timer); }
}

// Polls /api/me for `token`. `onGone` fires when the server no longer knows the token.
function useGame(token, onGone) {
  const [data, setData] = useState(null);
  const [offline, setOffline] = useState(false);
  const poke = useRef(() => {});
  const gone = useRef(onGone);
  gone.current = onGone;

  useEffect(() => {
    setData(null); setOffline(false);
    if (!token) return;
    let live = true, timer = 0, seq = 0;
    const poll = async () => {
      clearTimeout(timer);
      const mine = ++seq, { status, body } = await call(`/api/me?token=${encodeURIComponent(token)}`);
      if (!live || mine !== seq) return;
      let wait = 1500;
      if (status === 200 && body?.game) {
        setData({ ...body, at: performance.now() }); setOffline(false);
        if (body.game.status === 'running') wait = 700;
      } else if (status === 404 && body?.error) return gone.current();
      else setOffline(true);
      timer = setTimeout(poll, wait);
    };
    poke.current = poll;
    poll();
    const wake = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', wake);
    return () => { live = false; clearTimeout(timer); document.removeEventListener('visibilitychange', wake); poke.current = () => {}; };
  }, [token]);

  return { data, offline, refresh: useCallback(() => poke.current(), []) };
}

export { store, call, useGame };
