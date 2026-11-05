import { useRef, useState } from 'react';
import { LOOP_SIZES, loopLabel } from '../audio/constants';
import type { DeckId, DeckState } from '../audio/types';
import { useFrame } from '../hooks/useFrame';
import { formatBpm, formatPercent, formatTime } from '../lib/format';
import { engine, keyboard } from '../state/controller';
import { useKeyPressed } from '../state/KeyboardController';
import type { Action } from '../state/keymap';
import { useStore } from '../state/store';
import { Fader } from './controls/Fader';
import { KeyHint } from './controls/KeyHint';
import { TrackDrop, useFileDrop } from './TrackLoader';
import { OverviewWaveform, ZoomWaveform } from './Waveform';

const useDeck = (id: DeckId) => useStore(engine.store, (s) => s.decks[id]);

function codeOf(match: (a: Action) => boolean, shift = false) {
  return keyboard.codeFor(match, shift);
}

export function Deck({ id }: { id: DeckId }) {
  const deck = useDeck(id);
  const [over, dropProps] = useFileDrop((files) => files[0] && engine.loadDeck(id, files[0]));
  const ready = deck.status === 'ready';
  return (
    <section
      className={`deck deck--${id.toLowerCase()} ${over ? 'is-drop' : ''} ${deck.playing ? 'is-playing' : ''}`}
      aria-label={`Deck ${id}`}
      {...dropProps}
    >
      <PitchFader id={id} deck={deck} />
      <div className="deck-body">
        <DeckHeader id={id} deck={deck} />
        <TrackInfo id={id} deck={deck} />
        <div className="deck-wave">
          <ZoomWaveform id={id} />
          {!ready && <TrackDrop id={id} deck={deck} />}
          {deck.loading && ready && <div className="deck-loading">LOADING {deck.loading.toUpperCase()}</div>}
        </div>
        <div className="deck-overview">
          <OverviewWaveform id={id} />
        </div>
        <TimeRow id={id} deck={deck} />
        <Transport id={id} deck={deck} />
      </div>
    </section>
  );
}

function statusText(d: DeckState) {
  if (d.loading && d.status !== 'ready') return 'LOADING';
  if (d.status === 'empty') return 'NO TRACK';
  if (d.status === 'error') return 'LOAD ERROR';
  if (d.previewing) return 'CUE PREVIEW';
  if (d.playing) return 'PLAYING';
  return 'PAUSED';
}

function DeckHeader({ id, deck }: { id: DeckId; deck: DeckState }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <header className="deck-head">
      <div className="deck-id">
        <span className="deck-id-label">DECK</span>
        <span className="deck-id-letter">{id}</span>
      </div>
      <div className="deck-status">
        <span className={`led ${deck.playing ? 'is-on' : ''}`} />
        <span>{statusText(deck)}</span>
        {deck.loop && <span className="chip chip--accent">LOOP</span>}
        {deck.muted && <span className="chip chip--invert">MUTED</span>}
      </div>
      <button
        type="button"
        className="btn btn--ghost deck-load"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => input.current?.click()}
        title="Load a track (or drop a file on the deck)"
      >
        LOAD
      </button>
      <input
        ref={input}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.aif,.aiff,.opus"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void engine.loadDeck(id, f);
          e.target.value = '';
        }}
      />
    </header>
  );
}

function Platter({ id }: { id: DeckId }) {
  const disc = useRef<HTMLDivElement>(null);
  useFrame(() => {
    const deck = engine.decks?.[id];
    if (!deck || !disc.current) return;
    const pos = deck.position(Math.min(engine.clock(), engine.ctx.currentTime));
    // 33⅓ rpm = 200°/s of track time.
    disc.current.style.transform = `rotate(${(pos * 200) % 360}deg)`;
  });
  return (
    <div className="platter" aria-hidden="true">
      <div className="platter-disc" ref={disc}>
        <span className="platter-mark" />
        <span className="platter-label">{id}</span>
      </div>
    </div>
  );
}

function TrackInfo({ id, deck }: { id: DeckId; deck: DeckState }) {
  const [editing, setEditing] = useState(false);
  const ready = deck.status === 'ready';
  const effective = deck.bpm ? deck.bpm * deck.rate : null;
  return (
    <div className="deck-track">
      <Platter id={id} />
      <div className="deck-title-wrap">
        <div className="deck-title" title={deck.fileName}>
          {ready ? deck.title : deck.loading ? `Loading ${deck.loading}` : 'No track loaded'}
        </div>
        <div className="deck-meta">
          {ready ? (
            <>
              <span>{deck.format}</span>
              <span>{(deck.sampleRate / 1000).toFixed(1)} kHz</span>
              <span>{deck.channels > 1 ? 'STEREO' : 'MONO'}</span>
              <span>{formatTime(deck.duration, false)}</span>
            </>
          ) : (
            <span>MP3 · WAV · OGG · M4A</span>
          )}
        </div>
      </div>
      <div className={`deck-bpm ${!ready ? 'is-off' : ''}`}>
        {editing ? (
          <input
            className="deck-bpm-input"
            autoFocus
            type="text"
            inputMode="decimal"
            defaultValue={deck.bpm ? deck.bpm.toFixed(2) : ''}
            aria-label={`Deck ${id} BPM`}
            onBlur={(e) => {
              const v = parseFloat(e.target.value.replace(',', '.').replace(/[^0-9.]/g, ''));
              if (Number.isFinite(v) && v >= 40 && v <= 300) engine.setBpm(id, v);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <button
            type="button"
            className="deck-bpm-value"
            disabled={!ready}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setEditing(true)}
            title={deck.bpmSource === 'auto' ? 'Detected tempo — click to edit' : 'Click to set the tempo'}
          >
            {deck.analyzing ? '···' : formatBpm(effective)}
          </button>
        )}
        <div className="deck-bpm-foot">
          <span className="deck-bpm-label">{deck.bpmSource === 'manual' ? 'BPM · SET' : 'BPM'}</span>
          <button
            type="button"
            className="mini"
            disabled={!deck.bpm}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => deck.bpm && engine.setBpm(id, deck.bpm / 2)}
            title="Half tempo"
          >
            /2
          </button>
          <button
            type="button"
            className="mini"
            disabled={!deck.bpm}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => deck.bpm && engine.setBpm(id, deck.bpm * 2)}
            title="Double tempo"
          >
            ×2
          </button>
        </div>
      </div>
    </div>
  );
}

function TimeRow({ id, deck }: { id: DeckId; deck: DeckState }) {
  const elapsed = useRef<HTMLSpanElement>(null);
  const remain = useRef<HTMLSpanElement>(null);
  const last = useRef('');
  useFrame(() => {
    const d = engine.decks?.[id];
    if (!d) return;
    const pos = d.loaded ? d.position(Math.min(engine.clock(), engine.ctx.currentTime)) : 0;
    const dur = d.state.duration;
    const a = formatTime(pos);
    const b = `−${formatTime(Math.max(0, dur - pos))}`;
    const sig = a + b;
    if (sig === last.current) return;
    last.current = sig;
    if (elapsed.current) elapsed.current.textContent = a;
    if (remain.current) remain.current.textContent = b;
  });
  return (
    <div className="deck-time">
      <span className="deck-time-elapsed" ref={elapsed}>
        00:00.0
      </span>
      <span className="deck-time-cue">CUE {formatTime(deck.cuePoint)}</span>
      <span className="deck-time-remain" ref={remain}>
        −00:00.0
      </span>
    </div>
  );
}

function HoldButton({
  className,
  onDown,
  onUp,
  code,
  children,
  label,
  disabled,
  on,
}: {
  className?: string;
  onDown: () => void;
  onUp?: () => void;
  code: string | null;
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  on?: boolean;
}) {
  const held = useKeyPressed(keyboard, code);
  const [down, setDown] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className={`pbtn ${className ?? ''} ${held || down ? 'is-pressed' : ''} ${on ? 'is-on' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDown(true);
        onDown();
      }}
      onPointerUp={() => {
        setDown(false);
        onUp?.();
      }}
      onPointerCancel={() => {
        setDown(false);
        onUp?.();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onDown();
          onUp?.();
        }
      }}
    >
      {children}
      <KeyHint code={code} />
    </button>
  );
}

function Transport({ id, deck }: { id: DeckId; deck: DeckState }) {
  const ready = deck.status === 'ready';
  const isDeck = (a: Action) => 'deck' in a && a.deck === id;
  const loopIndex = deck.loopIndex;
  return (
    <div className="deck-transport">
      <HoldButton
        className="pbtn--play"
        label={deck.playing ? `Pause deck ${id}` : `Play deck ${id}`}
        code={codeOf((a) => a.kind === 'play' && isDeck(a))}
        onDown={() => engine.togglePlay(id)}
        disabled={!ready}
        on={deck.playing && !deck.previewing}
      >
        <span className="pbtn-icon">{deck.playing && !deck.previewing ? <PauseIcon /> : <PlayIcon />}</span>
        <span className="pbtn-label">{deck.playing && !deck.previewing ? 'PAUSE' : 'PLAY'}</span>
      </HoldButton>
      <HoldButton
        className="pbtn--cue"
        label={`Cue deck ${id}`}
        code={codeOf((a) => a.kind === 'cue' && isDeck(a))}
        onDown={() => engine.cueDown(id)}
        onUp={() => engine.cueUp(id)}
        disabled={!ready}
        on={deck.previewing}
      >
        <span className="pbtn-label">CUE</span>
      </HoldButton>
      <div className="loop-group">
        <HoldButton
          className="pbtn--loop"
          label={`Loop deck ${id}`}
          code={codeOf((a) => a.kind === 'loop' && isDeck(a))}
          onDown={() => engine.toggleLoop(id)}
          disabled={!ready}
          on={!!deck.loop}
        >
          <span className="pbtn-label">LOOP</span>
          <span className="pbtn-sub">{loopLabel(loopIndex, deck.bpm)}</span>
        </HoldButton>
        <HoldButton
          className="pbtn--small"
          label={`Halve loop deck ${id}`}
          code={codeOf((a) => a.kind === 'loopSize' && a.dir === -1 && isDeck(a))}
          onDown={() => engine.resizeLoop(id, -1)}
          disabled={loopIndex === 0}
        >
          <span className="pbtn-label">½</span>
        </HoldButton>
        <HoldButton
          className="pbtn--small"
          label={`Double loop deck ${id}`}
          code={codeOf((a) => a.kind === 'loopSize' && a.dir === 1 && isDeck(a))}
          onDown={() => engine.resizeLoop(id, 1)}
          disabled={loopIndex === LOOP_SIZES.length - 1}
        >
          <span className="pbtn-label">2×</span>
        </HoldButton>
      </div>
    </div>
  );
}

function PitchFader({ id, deck }: { id: DeckId; deck: DeckState }) {
  const range = useStore(engine.store, (s) => s.settings.speedRange);
  const isDeck = (a: Action) => 'deck' in a && a.deck === id;
  const down = codeOf((a) => a.kind === 'speed' && a.dir === -1 && isDeck(a));
  const up = codeOf((a) => a.kind === 'speed' && a.dir === 1 && isDeck(a));
  const pDown = useKeyPressed(keyboard, down);
  const pUp = useKeyPressed(keyboard, up);
  const v = 0.5 + (deck.rate - 1) / (2 * range);
  return (
    <div className="pitch">
      <span className="pitch-end">+{Math.round(range * 100)}</span>
      <Fader
        value={v}
        onChange={(nv) => engine.setRate(id, 1 + (nv - 0.5) * 2 * range)}
        defaultValue={0.5}
        ticks={[0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]}
        center
        label={`Deck ${id} speed`}
        valueText={formatPercent(deck.rate)}
        className="pitch-fader"
        pressed={pDown || pUp}
      />
      <span className="pitch-end">−{Math.round(range * 100)}</span>
      <span className={`pitch-value ${deck.rate !== 1 ? 'is-moved' : ''}`}>{formatPercent(deck.rate)}</span>
      <span className="pitch-label">SPEED</span>
      <span className="pitch-keys">
        <KeyHint code={down} />
        <KeyHint code={up} />
      </span>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" fill="currentColor" />
    </svg>
  );
}
