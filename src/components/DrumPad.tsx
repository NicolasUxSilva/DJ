import { useEffect, useRef, useState } from 'react';
import type { PadState } from '../audio/types';
import { engine, keyboard } from '../state/controller';
import { useKeyPressed } from '../state/KeyboardController';
import { labelForCode } from '../state/keymap';
import { useStore } from '../state/store';
import { useLayoutMap } from '../hooks/useLayoutMap';
import { Fader } from './controls/Fader';
import { useFileDrop } from './TrackLoader';

export function DrumPad() {
  const pads = useStore(engine.store, (s) => s.pads);
  const kitInput = useRef<HTMLInputElement>(null);
  const kitName = useStore(engine.store, (s) => s.kitName);
  return (
    <section className="sampler" aria-label="Drum pad">
      <div className="pads">
        {pads.map((p) => (
          <Pad key={p.index} pad={p} />
        ))}
      </div>
      <PadInspector />
      <div className="kit-row">
        <span className="kit-label">
          KIT <b>{kitName}</b>
        </span>
        <button
          type="button"
          className="mini"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => kitInput.current?.click()}
          title="Load up to 9 samples at once (assigned to pads in name order), or a .json kit"
        >
          LOAD KIT
        </button>
        <button type="button" className="mini" onMouseDown={(e) => e.preventDefault()} onClick={() => engine.exportKit()} title="Save this kit as a file">
          SAVE
        </button>
        <button type="button" className="mini" onMouseDown={(e) => e.preventDefault()} onClick={() => void engine.resetKit()} title="Restore the built-in kit">
          DEFAULT
        </button>
        <input
          ref={kitInput}
          type="file"
          multiple
          accept="audio/*,.wav,.mp3,.ogg,.m4a,.aif,.aiff,.flac,.json"
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) void engine.loadPadFiles(files, 0);
            e.target.value = '';
          }}
        />
      </div>
    </section>
  );
}

function Pad({ pad }: { pad: PadState }) {
  const ref = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const code = keyboard.codeFor((a) => a.kind === 'pad' && a.index === pad.index);
  const keyHeld = useKeyPressed(keyboard, code);
  const layout = useLayoutMap();
  const selected = useStore(engine.store, (s) => s.selectedPad === pad.index);
  const [down, setDown] = useState(false);
  const [over, dropProps] = useFileDrop((files) => {
    if (files.length > 1) void engine.loadPadFiles(files, pad.index);
    else void engine.loadPad(pad.index, files[0]);
  });

  // Hit flash: imperative so it restarts instantly on every trigger, even rapid rolls.
  useEffect(
    () =>
      engine.onPadTrigger((i) => {
        if (i !== pad.index || !ref.current) return;
        // Single keyframe at offset 0: animates from white back to the pad's own styles.
        ref.current.animate([{ backgroundColor: '#f5f5f5', color: '#080808', offset: 0 }], {
          duration: 220,
          easing: 'cubic-bezier(.2,.7,.3,1)',
        });
      }),
    [pad.index],
  );

  return (
    <button
      ref={ref}
      type="button"
      className={`pad ${keyHeld || down ? 'is-pressed' : ''} ${selected ? 'is-selected' : ''} ${over ? 'is-drop' : ''} ${pad.source === 'user' ? 'is-user' : ''}`}
      aria-label={`Pad ${pad.index + 1}: ${pad.name}`}
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDown(true);
        engine.selectPad(pad.index);
        engine.triggerPad(pad.index);
      }}
      onPointerUp={() => setDown(false)}
      onPointerCancel={() => setDown(false)}
      onContextMenu={(e) => {
        e.preventDefault();
        engine.selectPad(pad.index);
        input.current?.click();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          engine.triggerPad(pad.index);
        }
      }}
      {...dropProps}
    >
      <span className="pad-key">{code ? labelForCode(code, layout) : pad.index + 1}</span>
      {pad.source === 'user' && <span className="pad-user" title={pad.fileName ?? ''} />}
      <span className="pad-name">{pad.loading ? '···' : pad.name}</span>
      <span className="pad-vol" style={{ transform: `scaleX(${pad.volume})` }} />
      <input
        ref={input}
        type="file"
        accept="audio/*,.wav,.mp3,.ogg,.m4a,.aif,.aiff,.flac"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void engine.loadPad(pad.index, f);
          e.target.value = '';
        }}
      />
    </button>
  );
}

function PadInspector() {
  const index = useStore(engine.store, (s) => s.selectedPad);
  const pad = useStore(engine.store, (s) => s.pads[s.selectedPad]);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="pad-inspector">
      <span className="pad-inspector-id">
        PAD {index + 1}
        <b title={pad.fileName ?? pad.name}>{pad.name}</b>
      </span>
      <Fader
        orientation="horizontal"
        value={pad.volume}
        onChange={(v) => engine.setPadVolume(index, v)}
        defaultValue={0.85}
        label={`Pad ${index + 1} volume`}
        valueText={`${Math.round(pad.volume * 100)}`}
        className="pad-inspector-vol"
      />
      <span className="pad-inspector-val">{Math.round(pad.volume * 100)}</span>
      <button type="button" className="mini" onMouseDown={(e) => e.preventDefault()} onClick={() => input.current?.click()} title="Load a sample on this pad (or drop a file on it, or right-click the pad)">
        LOAD
      </button>
      <button
        type="button"
        className="mini"
        onMouseDown={(e) => e.preventDefault()}
        disabled={pad.source !== 'user'}
        onClick={() => void engine.resetPad(index)}
        title="Put the built-in sound back"
      >
        RESET
      </button>
      <input
        ref={input}
        type="file"
        accept="audio/*,.wav,.mp3,.ogg,.m4a,.aif,.aiff,.flac"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void engine.loadPad(index, f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
