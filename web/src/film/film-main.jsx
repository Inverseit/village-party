// Demo film only: the host screen, replayed from a recording, under a scripted camera and
// the film's own captions. Rendered frame by frame by demo/render.mjs.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shell/shell.css';
import { loadRecording, pumpEvents } from './replay.js';
import { attach } from './director.js';
import { SHOTS } from './shots.js';
import Overlay from './overlay.jsx';
import './film.css';

const q = new URLSearchParams(location.search);
const shot = SHOTS.find(s => s.id === q.get('shot')) || SHOTS[0];
const warm = +(q.get('warm') ?? 2);
const filmT = () => window.__film.vt / 1000 - warm;   // seconds into the shot (negative while warming up)
document.body.className = `chrome-${shot.chrome || 'none'}${shot.labels === false ? ' no-labels' : ''}`;

let setT = () => {};
function Film({ IslandApp, PartyOverlay }) {
  const [t, set] = useState(filmT());
  useEffect(() => { setT = set; }, []);
  return (
    <>
      <IslandApp />
      <PartyOverlay />
      <Overlay shot={shot} t={t} />
    </>
  );
}

(async () => {
  await loadRecording();
  // imported only now, so the store's first /state already hits the recording
  const [{ default: IslandApp }, { default: PartyOverlay }] = await Promise.all([import('../island/IslandApp.jsx'), import('../party/PartyOverlay.jsx')]);
  createRoot(document.getElementById('root')).render(<Film IslandApp={IslandApp} PartyOverlay={PartyOverlay} />);
  let attached = false;
  window.__film.onFrame(() => {
    pumpEvents(Date.now());
    setT(filmT());
    const el = document.querySelector('island-3d');
    if (!attached && el?.camera) { attach(el, () => shot, filmT); attached = true; }
    if (el && shot.labels === false) el.setAttribute('hide-labels', '');
  });
  const wait = async () => { for (;;) { const el = document.querySelector('island-3d'); if (el?.camera && document.fonts.status === 'loaded') return; await window.__film.realSleep(50); window.__film.step(0); } };
  await wait();
  await document.fonts.ready;
  window.__ready = true;
})();
