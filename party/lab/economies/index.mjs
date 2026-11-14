import e0 from './e0.mjs';
import e1 from './e1.mjs';
import e2 from './e2.mjs';
import e3 from './e3.mjs';
import e4 from './e4.mjs';
import rec from './recommended.mjs';
export const ECONOMIES = [...e0, ...e1, ...e2, ...e3, ...e4];     // the candidates, compared under the same house rule
export const ALL = [...ECONOMIES, ...rec];
export const byId = id => ALL.find(e => e.id.toLowerCase() === String(id).toLowerCase());
