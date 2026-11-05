import type { Settings } from '../audio/types';

const KEY = 'rhythm.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  xfadeCurve: 'smooth',
  xfadeTravel: 1.2,
  speedRange: 0.16,
  logoMotion: true,
  tempoRange: 1,
};

export interface Persisted {
  settings: Settings;
  masterVolume: number;
  samplerVolume: number;
}

export function loadPersisted(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Partial<Persisted>;
    return { ...p, settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) } };
  } catch {
    return {};
  }
}

export function savePersisted(p: Persisted) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable (private mode) — settings just won't persist */
  }
}
