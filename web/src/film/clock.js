// Demo film only. A virtual clock, installed before anything else on the page runs: time
// moves only when the renderer calls __film.step(), so every frame is exact and repeatable
// however slow the machine draws it.
(function () {
  const q = new URLSearchParams(location.search);
  const RealDate = Date, realSetTimeout = setTimeout;
  const epoch = +q.get('epoch') || RealDate.now();
  const speed = +q.get('speed') || 1;                    // recording ms per virtual ms
  let vt = 0, seq = 0;
  const timers = new Map(), rafs = new Map();
  const wall = () => epoch + vt * speed;
  performance.now = () => vt;
  class FDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(wall()); }
    static now() { return wall(); }
  }
  window.Date = FDate;
  window.setTimeout = (fn, ms = 0, ...args) => { const id = ++seq; timers.set(id, { at: vt + Math.max(0, +ms || 0), fn, args }); return id; };
  window.setInterval = (fn, ms = 0, ...args) => { const id = ++seq; const every = Math.max(1, +ms || 1); timers.set(id, { at: vt + every, fn, args, every }); return id; };
  window.clearTimeout = window.clearInterval = id => { timers.delete(id); };
  window.requestAnimationFrame = fn => { const id = ++seq; rafs.set(id, fn); return id; };
  window.cancelAnimationFrame = id => { rafs.delete(id); };

  const seen = new WeakMap();
  function syncAnimations() {
    for (const a of document.getAnimations()) {
      if (!seen.has(a)) { seen.set(a, vt - (a.currentTime || 0)); a.pause(); }
      a.currentTime = vt - seen.get(a);
    }
  }
  const before = [];
  window.__film = {
    get vt() { return vt; }, wall, speed,
    onFrame(fn) { before.push(fn); },
    realSleep: ms => new Promise(r => realSetTimeout(r, ms)),
    // advance by ms: fire due timers in order, then one animation frame
    step(ms, draw = true) {
      const end = vt + ms;
      for (let guard = 0; guard < 5000; guard++) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        const [id, t] = next;
        vt = Math.max(vt, t.at);
        if (t.every) t.at += t.every; else timers.delete(id);
        try { t.fn(...t.args); } catch (e) { console.error(e); }
      }
      vt = end;
      for (const fn of before) try { fn(vt); } catch (e) { console.error(e); }
      if (draw) { const list = [...rafs.values()]; rafs.clear(); for (const fn of list) try { fn(vt); } catch (e) { console.error(e); } }
      syncAnimations();
    },
  };
})();
