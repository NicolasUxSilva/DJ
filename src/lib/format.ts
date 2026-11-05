export function formatTime(sec: number, tenths = true): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const base = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return tenths ? `${base}.${Math.floor((sec * 10) % 10)}` : base;
}

export function formatPercent(rate: number): string {
  const p = (rate - 1) * 100;
  const sign = p > 0.0049 ? '+' : p < -0.0049 ? '−' : '±';
  return `${sign}${Math.abs(p).toFixed(2)}%`;
}

export function formatDb(db: number): string {
  if (db <= -25.9) return 'KILL';
  const sign = db > 0.05 ? '+' : db < -0.05 ? '−' : '';
  return `${sign}${Math.abs(db).toFixed(1)} dB`;
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatBpm(bpm: number | null): string {
  return bpm ? bpm.toFixed(1) : '—';
}

export function linToDb(v: number): number {
  return v > 1e-5 ? 20 * Math.log10(v) : -100;
}
