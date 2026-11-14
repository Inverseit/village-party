import './island3d.js';
const el = document.querySelector('island-3d');
window.island = el;
const q = new URLSearchParams(location.search);
if (q.has('hide')) el.setAttribute('hide-labels', '');
if (q.has('fxattr')) el.setAttribute('fx', q.get('fxattr'));
const set = () => { if (!el.orbit) return setTimeout(set, 100); const o = el.orbit;
  if (q.has('r')) o.r = o.tr = +q.get('r'); if (q.has('theta')) o.theta = o.ttheta = +q.get('theta'); if (q.has('phi')) o.phi = o.tphi = +q.get('phi'); };
set();
const wx = q.get('wx');
if (wx) setInterval(() => { if (el.fx && !(q.has('off') && performance.now() > +q.get('off'))) { el.fx.target = wx; if (!q.has('fade')) el.fx.w[wx] = 1; } }, 30);
if (q.has('lp')) setTimeout(() => { el.lowPower = true; }, 2500);
if (q.has('ui')) {
  const box = (css, t) => { const d = document.createElement('div'); d.className = 'mock'; d.style.cssText = css; d.textContent = t; document.body.appendChild(d); };
  box('left:24px;top:70px;width:270px;height:140px', 'join badge');
  box('left:50%;top:18px;width:300px;height:110px;transform:translateX(-50%)', 'clock');
  box('right:24px;top:18px;width:calc(35% - 24px);height:55%', 'leaderboard');
  box('left:24px;bottom:126px;width:330px;height:150px', 'feed');
  box('left:0;right:0;bottom:0;height:110px;border-radius:0', 'bottom bar');
}
window.addEventListener('error', e => console.log('PAGE ERROR', e.message));
// frame-time benchmark: ?bench=N times N frames of the whole loop, with gl.finish() so the GPU's share is in it
if (q.has('bench')) {
  const N = +q.get('bench') || 120, times = [];
  const go = () => {
    if (!el.renderer || !el.blobs) return setTimeout(go, 200);
    const gl = el.renderer.getContext(), orig = Object.getPrototypeOf(el).loop;
    let skip = 60;
    el.loop = function () {
      const t0 = performance.now(); orig.call(this); gl.finish(); const dt = performance.now() - t0;
      if (skip-- > 0) return;
      times.push(dt);
      if (times.length === N) {
        times.sort((a, b) => a - b);
        const avg = times.reduce((a, b) => a + b, 0) / N, sz = el.renderer.getDrawingBufferSize(new (Object.getPrototypeOf(el.camera.position).constructor)());
        console.log(`BENCH blobs=${el.blobs.size} buffer=${el.renderer.domElement.width}x${el.renderer.domElement.height} avg=${avg.toFixed(2)}ms median=${times[N >> 1].toFixed(2)}ms p95=${times[Math.floor(N * 0.95)].toFixed(2)}ms max=${times[N - 1].toFixed(2)}ms`);
      }
    };
  };
  setTimeout(go, +q.get('benchAfter') || 2500);
}
{ const img = new Image(); img.style.display = 'none'; img.src = `http://localhost:5187/wait?ms=${q.get('wait') || 6000}`; document.body.appendChild(img); }
