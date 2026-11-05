import { useRef } from 'react';
import faceUrl from '../assets/logo/rhythm-face.webp';
import whiteMaskUrl from '../assets/logo/rhythm-white-mask.webp';
import { frameLevels, useFrame } from '../hooks/useFrame';
import { engine } from '../state/controller';

const LAYERS = 10;
/** Resting pose: a slight three-quarter turn so the depth reads. */
const REST_X = 7;
const REST_Y = -16;
const DRAG_DEG_PER_PX = 0.55;
const FRICTION = 2.2; // 1/s, inertia decay while coasting
const SETTLE_SPEED = 70; // deg/s: below this the logo eases back to the front
const SPRING_K = 26;
const SPRING_C = 7.5;

type Phase = 'idle' | 'drag' | 'coast' | 'settle';

/**
 * The RHYTHM logo as a small extruded object. Grab and drag horizontally to spin it
 * around its vertical axis; on release it coasts with inertia, slows down and settles
 * back facing front. Pure CSS 3D transforms on stacked masked layers.
 */
export function Logo3D() {
  const obj = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  const shine = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const m = useRef({
    phase: 'idle' as Phase,
    angle: 0,
    vel: 0,
    target: 0,
    startX: 0,
    startAngle: 0,
    lastX: 0,
    lastT: 0,
    push: 0,
  });

  useFrame((_, dt) => {
    const s = m.current;
    if (s.phase === 'coast') {
      s.angle += s.vel * dt;
      s.vel *= Math.exp(-FRICTION * dt);
      if (Math.abs(s.vel) < SETTLE_SPEED) {
        s.phase = 'settle';
        s.target = Math.round(s.angle / 360) * 360;
      }
    } else if (s.phase === 'settle') {
      const acc = -SPRING_K * (s.angle - s.target) - SPRING_C * s.vel;
      s.vel += acc * dt;
      s.angle += s.vel * dt;
      if (Math.abs(s.angle - s.target) < 0.05 && Math.abs(s.vel) < 0.5) {
        s.angle = s.target = 0;
        s.vel = 0;
        s.phase = 'idle';
      }
    }
    // Subtle response to the low end of the mix: the object leans toward you on kicks.
    let pushTarget = 0;
    if (engine.state.settings.logoMotion && engine.state.audio === 'running') {
      pushTarget = Math.min(1, frameLevels().low * 2.2);
    }
    s.push += (pushTarget - s.push) * Math.min(1, dt * (pushTarget > s.push ? 30 : 6));

    const ry = REST_Y + s.angle;
    const rx = REST_X - s.push * 2;
    if (obj.current) {
      obj.current.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateZ(${(s.push * 0.6).toFixed(3)}rem)`;
    }
    const rad = (ry * Math.PI) / 180;
    if (shadow.current) {
      const sx = Math.max(0.04, Math.abs(Math.cos(rad)));
      shadow.current.style.transform = `translate(${(0.5 + s.push * 0.3).toFixed(3)}rem, ${(0.9 + s.push * 0.4).toFixed(3)}rem) scaleX(${sx.toFixed(3)})`;
      shadow.current.style.opacity = (0.75 - s.push * 0.2).toFixed(3);
    }
    if (shine.current) {
      // Light comes from the upper left; the sheen slides as the face turns.
      const p = 50 + Math.sin(rad) * 60;
      shine.current.style.backgroundPosition = `${p.toFixed(1)}% 0`;
    }
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = m.current;
    s.phase = 'drag';
    s.startX = s.lastX = e.clientX;
    s.startAngle = s.angle;
    s.lastT = performance.now();
    s.vel = 0;
    root.current?.classList.add('is-grabbing');
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = m.current;
    if (s.phase !== 'drag') return;
    const now = performance.now();
    const dt = Math.max(1, now - s.lastT) / 1000;
    const instant = ((e.clientX - s.lastX) * DRAG_DEG_PER_PX) / dt;
    s.vel = s.vel * 0.6 + instant * 0.4;
    s.lastX = e.clientX;
    s.lastT = now;
    s.angle = s.startAngle + (e.clientX - s.startX) * DRAG_DEG_PER_PX;
  };
  const onPointerUp = () => {
    const s = m.current;
    if (s.phase !== 'drag') return;
    // A pause before release means no fling.
    if (performance.now() - s.lastT > 80) s.vel = 0;
    s.vel = Math.max(-1400, Math.min(1400, s.vel));
    s.phase = 'coast';
    root.current?.classList.remove('is-grabbing');
  };

  const maskStyle = { WebkitMaskImage: `url(${faceUrl})`, maskImage: `url(${faceUrl})` } as React.CSSProperties;
  const whiteMask = { WebkitMaskImage: `url(${whiteMaskUrl})`, maskImage: `url(${whiteMaskUrl})` } as React.CSSProperties;

  return (
    <div
      ref={root}
      className="logo3d"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => {
        const s = m.current;
        s.vel = 900;
        s.phase = 'coast';
      }}
      title="RHYTHM — drag to spin"
      role="img"
      aria-label="RHYTHM logo"
    >
      <div className="logo3d-shadow" ref={shadow}>
        <div style={maskStyle} />
      </div>
      <div className="logo3d-stage">
        <div className="logo3d-obj" ref={obj}>
          {Array.from({ length: LAYERS }, (_, i) => (
            <div
              key={i}
              className="logo3d-layer"
              style={{
                ...maskStyle,
                transform: `translateZ(${(-(i + 1) * 0.05).toFixed(3)}rem)`,
                backgroundColor: `hsl(0 0% ${Math.round(58 - (i / (LAYERS - 1)) * 34)}%)`,
              }}
            />
          ))}
          <div className="logo3d-back" style={maskStyle} />
          <img className="logo3d-face" src={faceUrl} alt="" draggable={false} />
          <div className="logo3d-shine" ref={shine} style={whiteMask} />
        </div>
      </div>
    </div>
  );
}
