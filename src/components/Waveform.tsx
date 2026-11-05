import { useEffect, useRef } from 'react';
import { useFrame } from '../hooks/useFrame';
import { engine } from '../state/controller';
import type { DeckId } from '../audio/types';

const COLORS = {
  futureFull: '#4b4b4b',
  futureLow: '#ececec',
  pastFull: '#2a2a2a',
  pastLow: '#7d7d7d',
  center: '#ffffff',
  cue: 'rgba(255,255,255,0.75)',
  loopFill: 'rgba(255,255,255,0.07)',
  loopEdge: 'rgba(255,255,255,0.55)',
};

/** Keeps a canvas' backing store matched to its CSS size × devicePixelRatio. */
function useCanvasSize(ref: React.RefObject<HTMLCanvasElement | null>, onResize?: () => void) {
  const cb = useRef(onResize);
  cb.current = onResize;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        cb.current?.();
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [ref]);
}

/** Scrolling close-up waveform with a fixed center playhead (low band drawn in white). */
export function ZoomWaveform({ id, seconds = 6 }: { id: DeckId; seconds?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const last = useRef('');
  useCanvasSize(ref, () => (last.current = ''));

  useFrame(() => {
    const canvas = ref.current;
    const deck = engine.decks?.[id];
    if (!canvas || !deck) return;
    const wf = deck.waveform;
    const W = canvas.width;
    const H = canvas.height;
    const pos = deck.position(Math.min(engine.clock(), engine.ctx.currentTime));
    const st = deck.state;
    const sig = `${W}x${H}|${st.trackId}|${pos.toFixed(4)}|${st.cuePoint}|${st.loop?.start}|${st.loop?.end}`;
    if (sig === last.current) return;
    last.current = sig;
    const g = canvas.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    if (!wf) return;
    const mid = H / 2;
    const cx = Math.round(W / 2);
    const secPerPx = seconds / W;
    const scale = (mid * 0.94) / 255;
    const past = new Path2D();
    const pastLow = new Path2D();
    const future = new Path2D();
    const futureLow = new Path2D();
    const { full, low, rate, length } = wf;
    for (let x = 0; x < W; x++) {
      const t0 = pos + (x - cx) * secPerPx;
      if (t0 < 0) continue;
      let b0 = Math.floor(t0 * rate);
      if (b0 >= length) break;
      const b1 = Math.min(length, Math.max(b0 + 1, Math.floor((t0 + secPerPx) * rate)));
      let mf = 0;
      let ml = 0;
      for (; b0 < b1; b0++) {
        if (full[b0] > mf) mf = full[b0];
        if (low[b0] > ml) ml = low[b0];
      }
      const hf = Math.max(0.5, mf * scale);
      const hl = ml * scale;
      const isPast = x < cx;
      (isPast ? past : future).rect(x, mid - hf, 1, hf * 2);
      if (hl > 0.5) (isPast ? pastLow : futureLow).rect(x, mid - hl, 1, hl * 2);
    }
    g.fillStyle = COLORS.pastFull;
    g.fill(past);
    g.fillStyle = COLORS.futureFull;
    g.fill(future);
    g.fillStyle = COLORS.pastLow;
    g.fill(pastLow);
    g.fillStyle = COLORS.futureLow;
    g.fill(futureLow);

    const toX = (t: number) => cx + (t - pos) / secPerPx;
    if (st.loop) {
      const x0 = toX(st.loop.start);
      const x1 = toX(st.loop.end);
      g.fillStyle = COLORS.loopFill;
      g.fillRect(x0, 0, x1 - x0, H);
      g.fillStyle = COLORS.loopEdge;
      g.fillRect(Math.round(x0), 0, 1, H);
      g.fillRect(Math.round(x1), 0, 1, H);
    }
    const xc = toX(st.cuePoint);
    if (xc > -10 && xc < W + 10) {
      const s = Math.max(4, H * 0.06);
      g.fillStyle = COLORS.cue;
      g.fillRect(Math.round(xc), 0, 1, H);
      g.beginPath();
      g.moveTo(xc - s, 0);
      g.lineTo(xc + s, 0);
      g.lineTo(xc, s * 1.2);
      g.fill();
    }
    const lw = Math.max(1, Math.round(W / 400));
    g.fillStyle = COLORS.center;
    g.fillRect(cx - Math.floor(lw / 2), 0, lw, H);
    const s = Math.max(4, H * 0.05);
    g.beginPath();
    g.moveTo(cx - s, H);
    g.lineTo(cx + s, H);
    g.lineTo(cx, H - s * 1.3);
    g.fill();
  });

  return <canvas ref={ref} className="wave-zoom" aria-hidden="true" />;
}

/** Whole-track overview. Doubles as the interactive progress bar (click / drag to seek). */
export function OverviewWaveform({ id }: { id: DeckId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const layers = useRef<{ key: string; dim: HTMLCanvasElement; bright: HTMLCanvasElement } | null>(null);
  const last = useRef('');
  const seeking = useRef(false);
  const lastSeek = useRef(0);
  useCanvasSize(ref, () => {
    layers.current = null;
    last.current = '';
  });

  const render = (W: number, H: number) => {
    const deck = engine.decks[id];
    const wf = deck.waveform!;
    const make = (fullColor: string, lowColor: string) => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d')!;
      const mid = H / 2;
      const scale = (mid * 0.96) / 255;
      const per = wf.length / W;
      const pf = new Path2D();
      const pl = new Path2D();
      for (let x = 0; x < W; x++) {
        const b0 = Math.floor(x * per);
        const b1 = Math.max(b0 + 1, Math.floor((x + 1) * per));
        let mf = 0;
        let ml = 0;
        for (let b = b0; b < b1 && b < wf.length; b++) {
          if (wf.full[b] > mf) mf = wf.full[b];
          if (wf.low[b] > ml) ml = wf.low[b];
        }
        const hf = Math.max(0.5, mf * scale);
        const hl = ml * scale;
        pf.rect(x, mid - hf, 1, hf * 2);
        if (hl > 0.5) pl.rect(x, mid - hl, 1, hl * 2);
      }
      g.fillStyle = fullColor;
      g.fill(pf);
      g.fillStyle = lowColor;
      g.fill(pl);
      return c;
    };
    return { dim: make('#2f2f2f', '#5c5c5c'), bright: make('#6a6a6a', '#f2f2f2') };
  };

  useFrame(() => {
    const canvas = ref.current;
    const deck = engine.decks?.[id];
    if (!canvas || !deck) return;
    const W = canvas.width;
    const H = canvas.height;
    const st = deck.state;
    const g = canvas.getContext('2d')!;
    if (!deck.waveform || !st.duration) {
      if (last.current !== 'empty') {
        g.clearRect(0, 0, W, H);
        last.current = 'empty';
      }
      return;
    }
    const key = `${W}x${H}|${st.trackId}`;
    if (!layers.current || layers.current.key !== key) layers.current = { key, ...render(W, H) };
    const pos = deck.position(Math.min(engine.clock(), engine.ctx.currentTime));
    const px = Math.round((pos / st.duration) * W);
    const sig = `${key}|${px}|${st.cuePoint}|${st.loop?.start}|${st.loop?.end}`;
    if (sig === last.current) return;
    last.current = sig;
    g.clearRect(0, 0, W, H);
    g.drawImage(layers.current.dim, 0, 0);
    if (px > 0) g.drawImage(layers.current.bright, 0, 0, px, H, 0, 0, px, H);
    if (st.loop) {
      const x0 = (st.loop.start / st.duration) * W;
      const x1 = Math.max(x0 + 2, (st.loop.end / st.duration) * W);
      g.fillStyle = 'rgba(255,255,255,0.16)';
      g.fillRect(x0, 0, x1 - x0, H);
    }
    const xc = Math.round((st.cuePoint / st.duration) * W);
    const s = Math.max(3, H * 0.14);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.beginPath();
    g.moveTo(xc - s, 0);
    g.lineTo(xc + s, 0);
    g.lineTo(xc, s * 1.2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.fillRect(Math.max(0, px - 1), 0, Math.max(2, Math.round(W / 500)), H);
  });

  const seekTo = (e: React.PointerEvent, force = false) => {
    const deck = engine.decks?.[id];
    if (!deck?.loaded) return;
    const now = performance.now();
    if (!force && now - lastSeek.current < 35) return;
    lastSeek.current = now;
    const r = ref.current!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    engine.seek(id, f * deck.state.duration);
  };

  return (
    <canvas
      ref={ref}
      className="wave-overview"
      role="slider"
      aria-label={`Deck ${id} position`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        seeking.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        seekTo(e, true);
      }}
      onPointerMove={(e) => seeking.current && seekTo(e)}
      onPointerUp={(e) => {
        if (seeking.current) seekTo(e, true);
        seeking.current = false;
      }}
      onPointerCancel={() => (seeking.current = false)}
    />
  );
}
