import { useEffect, useRef, useState } from 'react';
import { TEMPO_RANGES } from '../audio/analysis';
import { SPEED_RANGES } from '../audio/constants';
import type { Settings, TakeState } from '../audio/types';
import { useFrame } from '../hooks/useFrame';
import { formatBytes, formatTime } from '../lib/format';
import { engine } from '../state/controller';
import { useStore } from '../state/store';
import { Fader } from './controls/Fader';

/** Secondary area: recorded takes of this session + compact settings. */
export function SidePanel() {
  const [tab, setTab] = useState<'takes' | 'settings'>('takes');
  const takes = useStore(engine.store, (s) => s.takes);
  const recording = useStore(engine.store, (s) => s.recording.active);
  useEffect(() => {
    if (recording) setTab('takes');
  }, [recording]);
  return (
    <section className="side" aria-label="Takes and settings">
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'takes'}
          className={`tab ${tab === 'takes' ? 'is-active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setTab('takes')}
        >
          TAKES <span className="tab-count">{takes.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'settings'}
          className={`tab ${tab === 'settings' ? 'is-active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setTab('settings')}
        >
          SETTINGS
        </button>
      </div>
      {tab === 'takes' ? <Takes takes={takes} recording={recording} /> : <SettingsPanel />}
    </section>
  );
}

function Takes({ takes, recording }: { takes: TakeState[]; recording: boolean }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const bar = useRef<HTMLSpanElement | null>(null);

  useEffect(() => () => audio.current?.pause(), []);

  useFrame(() => {
    const a = audio.current;
    if (!a || playing === null || !bar.current) return;
    const t = takes.find((x) => x.id === playing);
    if (!t) return;
    bar.current.style.transform = `scaleX(${Math.min(1, a.currentTime / Math.max(0.1, t.duration))})`;
  });

  const toggle = (t: TakeState) => {
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.onended = () => setPlaying(null);
    }
    const a = audio.current;
    if (playing === t.id) {
      a.pause();
      setPlaying(null);
      return;
    }
    a.src = t.url;
    void a.play();
    setPlaying(t.id);
  };

  if (takes.length === 0) {
    return (
      <div className="takes-empty">
        {recording ? (
          <span>Recording the master output… press STOP or T to save the take.</span>
        ) : (
          <span>
            Press <kbd className="keyhint">R</kbd> to record the master mix, <kbd className="keyhint">T</kbd> to stop. Every take stays here for this session — play it back, download it as WebM or WAV.
          </span>
        )}
      </div>
    );
  }

  return (
    <ul className="takes">
      {takes.map((t) => (
        <li key={t.id} className={`take ${playing === t.id ? 'is-playing' : ''}`}>
          <button type="button" className="take-play" onMouseDown={(e) => e.preventDefault()} onClick={() => toggle(t)} aria-label={playing === t.id ? `Stop ${t.name}` : `Play ${t.name}`}>
            {playing === t.id ? '■' : '▶'}
          </button>
          <div className="take-info">
            <span className="take-name">{t.name}</span>
            <span className="take-meta">
              {formatTime(t.duration, false)} · {formatBytes(t.size)} · {new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {t.downloaded ? ' · SAVED' : ''}
            </span>
            {playing === t.id && (
              <span className="take-progress">
                <span ref={bar} />
              </span>
            )}
          </div>
          <button type="button" className="mini" onMouseDown={(e) => e.preventDefault()} onClick={() => void engine.downloadTake(t.id, 'native')} title={`Download ${t.mime}`}>
            {t.ext.toUpperCase()}
          </button>
          <button type="button" className="mini" onMouseDown={(e) => e.preventDefault()} onClick={() => void engine.downloadTake(t.id, 'wav')} title="Download as 16-bit WAV">
            WAV
          </button>
          <button
            type="button"
            className="mini mini--x"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (playing === t.id) {
                audio.current?.pause();
                setPlaying(null);
              }
              engine.deleteTake(t.id);
            }}
            aria-label={`Delete ${t.name}`}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

function Seg<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ v: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          type="button"
          key={String(o.v)}
          className={`seg-btn ${o.v === value ? 'is-active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SettingsPanel() {
  const s = useStore(engine.store, (st) => st.settings);
  const samplerVolume = useStore(engine.store, (st) => st.samplerVolume);
  const set = (p: Partial<Settings>) => engine.updateSettings(p);
  const travelToV = (t: number) => (t - 0.15) / (3 - 0.15);
  return (
    <div className="settings">
      <label className="set-row">
        <span>CROSSFADE CURVE</span>
        <Seg value={s.xfadeCurve} onChange={(v) => set({ xfadeCurve: v })} options={[{ v: 'smooth', label: 'SMOOTH' }, { v: 'cut', label: 'CUT' }]} />
      </label>
      <label className="set-row">
        <span>CROSSFADE KEY SPEED</span>
        <Fader
          orientation="horizontal"
          value={1 - travelToV(s.xfadeTravel)}
          onChange={(v) => set({ xfadeTravel: Math.round((0.15 + (1 - v) * (3 - 0.15)) * 20) / 20 })}
          defaultValue={1 - travelToV(1.2)}
          label="Crossfader key speed"
          className="set-fader"
        />
        <span className="set-val">{s.xfadeTravel.toFixed(2)} s</span>
      </label>
      <label className="set-row">
        <span>SPEED RANGE</span>
        <Seg value={s.speedRange} onChange={(v) => set({ speedRange: v })} options={SPEED_RANGES.map((r) => ({ v: r, label: `±${Math.round(r * 100)}%` }))} />
      </label>
      <label className="set-row">
        <span>TEMPO DETECTION</span>
        <Seg value={s.tempoRange} onChange={(v) => set({ tempoRange: v })} options={TEMPO_RANGES.map((r, i) => ({ v: i, label: `${r[0]}–${r[1]}` }))} />
      </label>
      <label className="set-row">
        <span>PADS VOLUME</span>
        <Fader orientation="horizontal" value={samplerVolume} onChange={(v) => engine.setSamplerVolume(v)} defaultValue={0.9} label="Pads volume" className="set-fader" />
        <span className="set-val">{Math.round(samplerVolume * 100)}</span>
      </label>
      <label className="set-row">
        <span>LOGO MOTION</span>
        <Seg value={s.logoMotion ? 1 : 0} onChange={(v) => set({ logoMotion: v === 1 })} options={[{ v: 1, label: 'ON' }, { v: 0, label: 'OFF' }]} />
      </label>
    </div>
  );
}
