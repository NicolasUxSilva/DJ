import type { CrossfadeCurve } from './types';

/**
 * Crossfader position (-1 = A, 0 = center, 1 = B) → [gainA, gainB].
 *
 * smooth: constant-power (equal loudness through the blend, -3 dB each at center).
 * cut:    both channels at full level for most of the travel, sharp cut near the edges
 *         (scratch / cut style). Uses a smoothstep so even fast cuts do not click.
 */
export function crossfadeGains(position: number, curve: CrossfadeCurve): [number, number] {
  const x = Math.max(-1, Math.min(1, position));
  if (curve === 'cut') {
    const edge = 0.12;
    const a = x <= 1 - edge ? 1 : smoothstep((1 - x) / edge);
    const b = x >= -1 + edge ? 1 : smoothstep((x + 1) / edge);
    return [a, b];
  }
  const t = (x + 1) / 2;
  return [Math.cos((t * Math.PI) / 2), Math.sin((t * Math.PI) / 2)];
}

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}
