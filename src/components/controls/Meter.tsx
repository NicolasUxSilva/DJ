import { useRef } from 'react';
import { frameLevels, useFrame } from '../../hooks/useFrame';
import { linToDb } from '../../lib/format';
import type { Levels } from '../../audio/AudioEngine';

const FLOOR_DB = -48;

interface MeterProps {
  channels: Array<keyof Levels>;
  className?: string;
  label?: string;
  horizontal?: boolean;
}

/** Segmented peak meter with peak hold, updated per frame without React renders. */
export function Meter({ channels, className = '', label, horizontal }: MeterProps) {
  const fills = useRef<Array<HTMLDivElement | null>>([]);
  const holds = useRef<Array<HTMLDivElement | null>>([]);
  const state = useRef(channels.map(() => ({ level: 0, hold: 0, holdAge: 0 })));

  useFrame((_, dt) => {
    const lv = frameLevels();
    channels.forEach((ch, i) => {
      const s = state.current[i];
      const db = linToDb(lv[ch] as number);
      const target = Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB));
      s.level = target > s.level ? target : Math.max(target, s.level - dt * 1.4);
      if (target >= s.hold) {
        s.hold = target;
        s.holdAge = 0;
      } else {
        s.holdAge += dt;
        if (s.holdAge > 0.9) s.hold = Math.max(s.level, s.hold - dt * 0.6);
      }
      const f = fills.current[i];
      const cut = `${((1 - s.level) * 100).toFixed(2)}%`;
      if (f) f.style.clipPath = horizontal ? `inset(0 ${cut} 0 0)` : `inset(${cut} 0 0 0)`;
      const h = holds.current[i];
      if (h) {
        if (horizontal) h.style.left = `${s.hold * 100}%`;
        else h.style.bottom = `${s.hold * 100}%`;
        h.style.opacity = s.hold > 0.02 ? '1' : '0';
        h.classList.toggle('is-hot', s.hold > 0.97);
      }
    });
  });

  return (
    <div className={`meter ${horizontal ? 'meter--h' : 'meter--v'} ${className}`} aria-label={label} role="img">
      {channels.map((ch, i) => (
        <div key={ch} className="meter-col">
          <div className="meter-off" />
          <div className="meter-on" ref={(el) => void (fills.current[i] = el)} />
          <div className="meter-hold" ref={(el) => void (holds.current[i] = el)} />
        </div>
      ))}
    </div>
  );
}
