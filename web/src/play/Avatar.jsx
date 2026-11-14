import React, { useEffect, useRef } from 'react';

// The villager as the big screen draws it: the same body, features and hat for an id
// (the numbers follow island/blob.js, which cannot be imported here because it pulls in three).
const PROFILE = [[0, 0], [0.26, 0.02], [0.43, 0.12], [0.5, 0.3], [0.47, 0.5], [0.39, 0.68], [0.32, 0.84], [0.29, 0.98], [0.24, 1.09], [0.13, 1.17], [0, 1.2]];
const LOOKS = [{ dx: 27, r: 10.5 }, { dx: 34, r: 13 }, { dx: 27, r: 7.5, specs: true }, { dx: 21, r: 9.5, blush: true }, { dx: 27, r: 10.5, brows: true }];
const INK = '#0b0b0d';
const rand = (id, salt) => { const v = Math.sin((id + 1) * (12.9898 + salt * 17.31)) * 43758.5453; return v - Math.floor(v); };
const bodyOf = id => {
  const extra = rand(id, 23);
  return { tall: 0.84 + rand(id, 20) * 0.4, girth: 0.86 + rand(id, 21) * 0.34, lean: (rand(id, 25) - 0.5) * 0.12,
           look: Math.floor(rand(id, 22) * 5) % 5, extra: extra < 0.4 ? -1 : extra < 0.6 ? 0 : extra < 0.8 ? 1 : 2 };
};
const darker = hex => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.7).toString(16).padStart(2, '0')).join('');

// mood: 'happy' | 'grin' | 'thinking' | 'sad'; drawn in a 128 x 128 cell
function face(g, mood, L, blink) {
  const cx = 64, ey = 44, gaze = mood === 'thinking' ? [4, -5] : [0, 0];
  g.lineCap = g.lineJoin = 'round'; g.strokeStyle = g.fillStyle = INK;
  if (L.blush) { g.fillStyle = '#ef7f93'; for (const s of [-1, 1]) { g.beginPath(); g.arc(cx + s * 40, 66, 9, 0, 7); g.fill(); } g.fillStyle = INK; }
  for (const s of [-1, 1]) {
    const x = cx + s * L.dx;
    g.beginPath();
    if (blink) { g.lineWidth = 4.5; g.moveTo(x - L.r, ey + 1); g.lineTo(x + L.r, ey + 1); g.stroke(); }
    else { g.arc(x + gaze[0], ey + gaze[1], L.r, 0, 7); g.fill(); }
    if (L.specs) { g.lineWidth = 4; g.beginPath(); g.arc(x, ey, 17, 0, 7); g.stroke(); }
    const tilt = mood === 'sad' ? 7 : mood === 'thinking' ? -3 * s : 0;
    if (L.brows || tilt) {
      g.lineWidth = L.brows ? 7 : 4.5;
      const by = ey - L.r - (L.specs ? 16 : 9);
      g.beginPath(); g.moveTo(x - s * 11, by - tilt); g.lineTo(x + s * 11, by + (tilt > 0 ? 2 : 0)); g.stroke();
    }
  }
  if (L.specs) { g.lineWidth = 4; g.beginPath(); g.moveTo(cx - L.dx + 17, ey); g.lineTo(cx + L.dx - 17, ey); g.stroke(); }
  g.lineWidth = 5.5;
  g.beginPath();
  if (mood === 'happy') { g.arc(cx, 70, 15, Math.PI * 0.14, Math.PI * 0.86); g.stroke(); }
  else if (mood === 'grin') { g.arc(cx, 70, 17, 0, Math.PI); g.closePath(); g.fill(); g.stroke(); }
  else if (mood === 'sad') { g.arc(cx, 96, 15, Math.PI * 1.17, Math.PI * 1.83); g.stroke(); }
  else { g.moveTo(cx + 2, 81); g.lineTo(cx + 15, 78); g.stroke(); }
}

function paint(g, { id, mood, color, blink, size }) {
  const B = bodyOf(id), unit = size / 1.78, W = B.girth * unit, H = B.tall * unit;
  g.clearRect(0, 0, size, size);
  g.save();
  g.translate(size / 2, size - 2);
  g.rotate(B.lean);
  const body = () => {
    const pts = [...PROFILE.map(([r, y]) => [r * W, -y * H]), ...PROFILE.slice(0, -1).reverse().map(([r, y]) => [-r * W, -y * H])];
    g.beginPath(); g.moveTo(0, 0);
    for (let i = 1; i < pts.length - 1; i++) g.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    g.closePath();
  };
  body(); g.fillStyle = color; g.fill();
  g.save(); body(); g.clip(); g.translate(W * 0.34, H * 0.05); body(); g.fillStyle = darker(color); g.globalAlpha = 0.55; g.fill(); g.restore();

  const fw = 0.53 * W, fh = 0.59 * H;
  g.save(); g.translate(-fw / 2, -1.15 * H); g.scale(fw / 128, fh / 128); face(g, mood, LOOKS[B.look], blink); g.restore();

  if (B.extra === 0) {                                      // a sprout
    g.strokeStyle = g.fillStyle = '#5fae3b'; g.lineWidth = Math.max(1.5, unit * 0.035); g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, -1.19 * H); g.lineTo(0, -1.35 * H); g.stroke();
    for (const s of [-1, 1]) { g.save(); g.translate(s * 0.09 * W, -1.37 * H); g.rotate(-s * 0.5); g.beginPath(); g.ellipse(0, 0, 0.1 * W, 0.03 * H + 1.5, 0, 0, 7); g.fill(); g.restore(); }
  } else if (B.extra === 1) {                               // a straw hat
    g.fillStyle = '#e2c275';
    g.beginPath(); g.ellipse(0, -1.11 * H, 0.31 * W, 0.045 * H, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(-0.2 * W, -1.11 * H); g.lineTo(-0.16 * W, -1.27 * H); g.lineTo(0.16 * W, -1.27 * H); g.lineTo(0.2 * W, -1.11 * H); g.closePath(); g.fill();
    g.fillStyle = '#b9974f'; g.fillRect(-0.195 * W, -1.15 * H, 0.39 * W, 0.03 * H);
  } else if (B.extra === 2) {                               // a bow
    g.fillStyle = '#d8434f';
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(0, -1.23 * H); g.lineTo(s * 0.15 * W, -1.3 * H); g.lineTo(s * 0.15 * W, -1.16 * H); g.closePath(); g.fill(); }
    g.beginPath(); g.arc(0, -1.23 * H, 0.04 * W + 1, 0, 7); g.fill();
  }
  g.restore();
}

export default function Avatar({ id, mood = 'happy', color = '#8a8f98', size = 64 }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current, dpr = Math.min(3, window.devicePixelRatio || 1), g = cv.getContext('2d');
    cv.width = cv.height = Math.round(size * dpr);
    let timer = 0;
    const draw = blink => {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(g, { id, mood, color, blink, size });
      timer = setTimeout(() => draw(!blink), blink ? 130 : 2600 + Math.random() * 2600);
    };
    draw(false);
    return () => clearTimeout(timer);
  }, [id, mood, color, size]);
  return <canvas ref={ref} className="avatar" style={{ width: size, height: size }} aria-hidden="true" />;
}
