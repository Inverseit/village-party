import React, { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** A QR code as one SVG path: dark on white, with a quiet zone. */
export default function Qr({ text, size = 240, quiet = 3, className }) {
  const { n, d } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text || ' ');
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    return { n, d };
  }, [text, quiet]);
  const box = n + quiet * 2;
  return (
    <svg className={className} width={size} height={size} viewBox={`0 0 ${box} ${box}`} shapeRendering="crispEdges" role="img" aria-label="QR code to join the game">
      <rect width={box} height={box} rx={1.2} fill="#fff" />
      <path d={d} fill="#17120e" />
    </svg>
  );
}
