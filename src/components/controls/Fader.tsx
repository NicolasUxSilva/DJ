import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

interface FaderProps {
  /** Normalized position 0..1 (0 = bottom/left). */
  value: number;
  onChange: (v: number) => void;
  orientation?: 'vertical' | 'horizontal';
  /** Double-click returns here. */
  defaultValue?: number;
  /** Tick marks at normalized positions. */
  ticks?: number[];
  /** Highlight a center detent tick. */
  center?: boolean;
  label: string;
  valueText?: string;
  className?: string;
  /** Pixel distance for the full travel when dragging the cap (defaults to track length). */
  wide?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
  pressed?: boolean;
}

/**
 * A physical-looking fader. Drag the cap (relative) or click the track (jump), wheel to
 * nudge, Shift-drag for fine moves, double-click to reset. Keyboard accessible.
 */
export function Fader({
  value,
  onChange,
  orientation = 'vertical',
  defaultValue,
  ticks,
  center,
  label,
  valueText,
  className = '',
  wide,
  style,
  pressed,
}: FaderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startPos: number; startValue: number; length: number } | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const vertical = orientation === 'vertical';

  const posFromEvent = (e: { clientX: number; clientY: number }) => {
    const r = trackRef.current!.getBoundingClientRect();
    return vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = trackRef.current!;
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const length = vertical ? r.height : r.width;
    const onCap = (e.target as HTMLElement).closest('.fader-cap');
    let startValue = valueRef.current;
    if (!onCap) {
      startValue = clamp01(posFromEvent(e));
      onChangeRef.current(startValue);
    }
    drag.current = { startPos: vertical ? e.clientY : e.clientX, startValue, length };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const delta = (vertical ? d.startPos - e.clientY : e.clientX - d.startPos) / d.length;
    onChangeRef.current(clamp01(d.startValue + delta * (e.shiftKey ? 0.2 : 1)));
  };

  const end = () => {
    drag.current = null;
  };

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? -e.deltaY : e.deltaX;
      onChangeRef.current(clamp01(valueRef.current + Math.sign(d) * Math.min(0.04, Math.abs(d) / 1500)));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.01 : 0.05;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(clamp01(value + step));
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(clamp01(value - step));
    else if (e.key === 'Home') onChange(0);
    else if (e.key === 'End') onChange(1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const pct = `${clamp01(value) * 100}%`;
  return (
    <div
      className={`fader fader--${orientation} ${wide ? 'fader--wide' : ''} ${pressed ? 'is-pressed' : ''} ${className}`}
      style={style}
    >
      <div
        ref={trackRef}
        className="fader-track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation={orientation}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={valueText}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
        onKeyDown={onKeyDown}
      >
        <div className="fader-rail" />
        {ticks?.map((t) => (
          <span
            key={t}
            className={`fader-tick ${center && t === 0.5 ? 'fader-tick--center' : ''}`}
            style={vertical ? { bottom: `${t * 100}%` } : { left: `${t * 100}%` }}
          />
        ))}
        <div className="fader-cap" style={vertical ? { bottom: pct } : { left: pct }} />
      </div>
    </div>
  );
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const TICKS_11 = Array.from({ length: 11 }, (_, i) => i / 10);
export const TICKS_5 = [0, 0.25, 0.5, 0.75, 1];
