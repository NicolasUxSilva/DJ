import { useRef } from 'react';
import { frameLevels, useFrame } from '../hooks/useFrame';
import { formatTime } from '../lib/format';
import { engine, keyboard } from '../state/controller';
import { useKeyPressed } from '../state/KeyboardController';
import { useStore } from '../state/store';
import { Fader } from './controls/Fader';
import { KeyHint } from './controls/KeyHint';
import { Meter } from './controls/Meter';

export function Header() {
  const audio = useStore(engine.store, (s) => s.audio);
  const sr = useStore(engine.store, (s) => s.sampleRate);
  const toast = useStore(engine.store, (s) => s.toast);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-name">RHYTHM</span>
        <span className="brand-sub">UNDERGROUND DJ PLAYGROUND</span>
      </div>
      <button
        type="button"
        className={`engine-status ${audio === 'running' ? 'is-live' : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => engine.resume()}
        title={audio === 'running' ? 'Audio engine running' : 'Browsers start audio after your first click or key press'}
      >
        <span className="led" />
        {audio === 'running' ? `LIVE · ${(sr / 1000).toFixed(1)} kHz` : audio === 'closed' ? 'NO AUDIO' : 'PRESS ANY KEY TO START'}
      </button>
      <div className="toast-slot" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.id}>
            {toast.text}
          </div>
        )}
      </div>
      <Recorder />
      <Master />
    </header>
  );
}

function Recorder() {
  const rec = useStore(engine.store, (s) => s.recording);
  const takes = useStore(engine.store, (s) => s.takes.length);
  const timer = useRef<HTMLSpanElement>(null);
  const start = keyboard.codeFor((a) => a.kind === 'recStart');
  const stop = keyboard.codeFor((a) => a.kind === 'recStop');
  const pStart = useKeyPressed(keyboard, start);
  const pStop = useKeyPressed(keyboard, stop);
  useFrame(() => {
    if (!timer.current) return;
    const s = engine.state.recording;
    const t = s.active ? formatTime((performance.now() - s.startedAt) / 1000, false) : '00:00';
    if (timer.current.textContent !== t) timer.current.textContent = t;
  });
  return (
    <div className={`rec ${rec.active ? 'is-rec' : ''}`}>
      <button
        type="button"
        className={`rec-btn ${pStart ? 'is-pressed' : ''}`}
        disabled={!rec.supported || rec.active}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => engine.startRecording()}
        aria-label="Start recording"
      >
        <span className="rec-dot" />
        REC
        <KeyHint code={start} />
      </button>
      <span className="rec-time" ref={timer}>
        00:00
      </span>
      <button
        type="button"
        className={`rec-btn ${pStop ? 'is-pressed' : ''}`}
        disabled={!rec.active}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void engine.stopRecording()}
        aria-label="Stop recording"
      >
        <span className="rec-square" />
        STOP
        <KeyHint code={stop} />
      </button>
      <span className="rec-count">{takes ? `${takes} TAKE${takes > 1 ? 'S' : ''}` : 'NO TAKES'}</span>
    </div>
  );
}

function Master() {
  const vol = useStore(engine.store, (s) => s.masterVolume);
  const down = keyboard.codeFor((a) => a.kind === 'master' && a.dir === -1);
  const up = keyboard.codeFor((a) => a.kind === 'master' && a.dir === 1);
  const pd = useKeyPressed(keyboard, down);
  const pu = useKeyPressed(keyboard, up);
  const limit = useRef<HTMLSpanElement>(null);
  useFrame(() => {
    limit.current?.classList.toggle('is-on', frameLevels().reduction < -1.5);
  });
  return (
    <div className="master">
      <span className="ctl-label">MASTER</span>
      <KeyHint code={down} />
      <Fader
        orientation="horizontal"
        value={vol}
        onChange={(v) => engine.setMasterVolume(v)}
        defaultValue={0.9}
        label="Master volume"
        valueText={`${Math.round(vol * 100)}`}
        className="master-fader"
        pressed={pd || pu}
      />
      <KeyHint code={up} />
      <span className="ctl-value">{Math.round(vol * 100)}</span>
      <Meter channels={['masterL', 'masterR']} horizontal className="master-meter" label="Master level" />
      <span className="limit" ref={limit} title="Safety limiter is reducing gain">
        LIMIT
      </span>
    </div>
  );
}
