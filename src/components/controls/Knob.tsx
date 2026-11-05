import { useEffect, useRef } from 'react';

interface KnobProps {
  /** Normalized position 0..1. */
  value: number;
  onChange: (v: number) => void;
  /** Position the value arc grows from (0.5 for bipolar controls). */
  origin?: number;
  defaultValue?: number;
  label: string;
  valueText?: string;
  pressed?: boolean;
  size?: 'md' | 'lg';
}

const SWEEP = 270;
const START = -135;

/** Rotary knob: drag vertically (Shift = fine), wheel, double-click resets. */
export function Knob({ value, onChange, origin = 0, defaultValue, label, valueText, pressed, size = 'md' }: KnobProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; v: number } | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const d = -e.deltaY;
      onChangeRef.current(clamp01(valueRef.current + Math.sign(d) * Math.min(0.04, Math.abs(d) / 1500)));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  const angle = START + clamp01(value) * SWEEP;
  const r = 40;
  const arc = (from: number, to: number) => {
    const a0 = ((START + from * SWEEP - 90) * Math.PI) / 180;
    const a1 = ((START + to * SWEEP - 90) * Math.PI) / 180;
    const large = Math.abs(to - from) * SWEEP > 180 ? 1 : 0;
    const sweep = to > from ? 1 : 0;
    return `M ${50 + r * Math.cos(a0)} ${50 + r * Math.sin(a0)} A ${r} ${r} 0 ${large} ${sweep} ${50 + r * Math.cos(a1)} ${50 + r * Math.sin(a1)}`;
  };
  const v = clamp01(value);

  return (
    <div
      ref={ref}
      className={`knob knob--${size} ${pressed ? 'is-pressed' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-valuetext={valueText}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, v: valueRef.current };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        onChange(clamp01(d.v + ((d.y - e.clientY) / 160) * (e.shiftKey ? 0.2 : 1)));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.01 : 0.05;
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(clamp01(value + step));
        else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(clamp01(value - step));
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path className="knob-track" d={arc(0, 1)} />
        {Math.abs(v - origin) > 0.002 && <path className="knob-value" d={v > origin ? arc(origin, v) : arc(v, origin)} />}
        {origin > 0 && origin < 1 && (
          <line className="knob-detent" x1="50" y1="4" x2="50" y2="9" transform={`rotate(${START + origin * SWEEP} 50 50)`} />
        )}
      </svg>
      <div className="knob-body" style={{ transform: `rotate(${angle}deg)` }}>
        <span className="knob-pointer" />
      </div>
    </div>
  );
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
