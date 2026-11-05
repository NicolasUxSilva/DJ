import { BASS_MAX_DB, BASS_MIN_DB } from '../audio/constants';
import type { DeckId } from '../audio/types';
import { formatDb } from '../lib/format';
import { engine, keyboard } from '../state/controller';
import { useKeyPressed } from '../state/KeyboardController';
import type { Action } from '../state/keymap';
import { useStore } from '../state/store';
import { Fader, TICKS_11 } from './controls/Fader';
import { KeyHint } from './controls/KeyHint';
import { Knob } from './controls/Knob';
import { Meter } from './controls/Meter';

/** dB → knob position with 0 dB at 12 o'clock (cut on the left half, boost on the right). */
const bassToKnob = (db: number) => (db <= 0 ? 0.5 * (1 - db / BASS_MIN_DB) : 0.5 + 0.5 * (db / BASS_MAX_DB));
const knobToBass = (v: number) => (v <= 0.5 ? BASS_MIN_DB * (1 - v / 0.5) : BASS_MAX_DB * ((v - 0.5) / 0.5));

export function Mixer() {
  return (
    <section className="mixer" aria-label="Mixer">
      <Channel id="A" />
      <Crossfader />
      <Channel id="B" />
    </section>
  );
}

function Channel({ id }: { id: DeckId }) {
  const deck = useStore(engine.store, (s) => s.decks[id]);
  const isDeck = (a: Action) => 'deck' in a && a.deck === id;
  const bassDown = keyboard.codeFor((a) => a.kind === 'bass' && a.dir === -1 && isDeck(a));
  const bassUp = keyboard.codeFor((a) => a.kind === 'bass' && a.dir === 1 && isDeck(a));
  const volDown = keyboard.codeFor((a) => a.kind === 'volume' && a.dir === -1 && isDeck(a), true);
  const volUp = keyboard.codeFor((a) => a.kind === 'volume' && a.dir === 1 && isDeck(a), true);
  const mute = keyboard.codeFor((a) => a.kind === 'mute' && isDeck(a));
  const shift = useStore(keyboard.pressed, (s) => s.shift);
  const bassDownPressed = useKeyPressed(keyboard, bassDown);
  const bassUpPressed = useKeyPressed(keyboard, bassUp);
  const bassPressed = bassDownPressed || bassUpPressed;
  const mutePressed = useKeyPressed(keyboard, mute);

  return (
    <div className={`channel channel--${id.toLowerCase()}`}>
      <div className="channel-id">
        <span className="channel-letter">{id}</span>
        <span className="channel-sub">CH</span>
      </div>
      <div className="channel-ctl channel-vol">
        <span className="ctl-label">VOL</span>
        <Fader
          value={deck.volume}
          onChange={(v) => engine.setVolume(id, v)}
          defaultValue={0.9}
          ticks={TICKS_11}
          label={`Deck ${id} volume`}
          valueText={`${Math.round(deck.volume * 100)}`}
          className="channel-fader"
          pressed={shift && bassPressed}
        />
        <div className="ctl-foot">
          <span className="ctl-value">{Math.round(deck.volume * 100)}</span>
          <span className="ctl-keys">
            <KeyHint code={volDown} shift />
            <KeyHint code={volUp} shift />
          </span>
        </div>
      </div>
      <div className="channel-ctl channel-bass">
        <span className="ctl-label">BASS</span>
        <Knob
          value={bassToKnob(deck.bassDb)}
          onChange={(v) => engine.setBass(id, Math.abs(v - 0.5) < 0.012 ? 0 : knobToBass(v))}
          origin={0.5}
          defaultValue={0.5}
          label={`Deck ${id} bass`}
          valueText={formatDb(deck.bassDb)}
          pressed={bassPressed && !shift}
        />
        <div className="ctl-foot">
          <span className={`ctl-value ${deck.bassDb <= BASS_MIN_DB + 0.1 ? 'is-kill' : ''}`}>{formatDb(deck.bassDb)}</span>
          <span className="ctl-keys">
            <KeyHint code={bassDown} />
            <KeyHint code={bassUp} />
          </span>
        </div>
      </div>
      <div className="channel-ctl channel-mute">
        <button
          type="button"
          className={`btn btn--square ${deck.muted ? 'is-on' : ''} ${mutePressed ? 'is-pressed' : ''}`}
          aria-pressed={deck.muted}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => engine.toggleMute(id)}
        >
          MUTE
        </button>
        <KeyHint code={mute} />
      </div>
      <Meter channels={[id === 'A' ? 'deckA' : 'deckB']} className="channel-meter" label={`Deck ${id} level`} />
    </div>
  );
}

function Crossfader() {
  const x = useStore(engine.store, (s) => s.crossfader);
  const curve = useStore(engine.store, (s) => s.settings.xfadeCurve);
  const left = keyboard.codeFor((a) => a.kind === 'xfade' && a.dir === -1);
  const center = keyboard.codeFor((a) => a.kind === 'xfadeCenter');
  const right = keyboard.codeFor((a) => a.kind === 'xfade' && a.dir === 1);
  const pl = useKeyPressed(keyboard, left);
  const pr = useKeyPressed(keyboard, right);
  const pc = useKeyPressed(keyboard, center);
  const pct = Math.round(((x + 1) / 2) * 100);
  return (
    <div className="xfade">
      <div className="xfade-head">
        <span className={`xfade-end ${x <= -0.999 ? 'is-full' : ''}`}>A</span>
        <span className="xfade-title">CROSSFADE</span>
        <span className="xfade-readout">{x === 0 ? 'CENTER' : x < 0 ? `A ${Math.round(-x * 100)}` : `B ${Math.round(x * 100)}`}</span>
        <span className={`xfade-end ${x >= 0.999 ? 'is-full' : ''}`}>B</span>
      </div>
      <Fader
        orientation="horizontal"
        value={(x + 1) / 2}
        onChange={(v) => engine.setCrossfader(Math.abs(v - 0.5) < 0.008 ? 0 : v * 2 - 1)}
        defaultValue={0.5}
        ticks={TICKS_11}
        center
        label="Crossfader"
        valueText={`${pct}`}
        className="xfade-fader"
        pressed={pl || pr || pc}
      />
      <div className="xfade-foot">
        <span className="xfade-keys">
          <KeyHint code={left} />
          <span>HOLD ◀</span>
        </span>
        <span className="xfade-keys">
          <KeyHint code={center} />
          <span>CENTER</span>
        </span>
        <button
          type="button"
          className="mini"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => engine.updateSettings({ xfadeCurve: curve === 'smooth' ? 'cut' : 'smooth' })}
          title="Crossfader curve: SMOOTH (constant power blend) or CUT (sharp, for cuts and scratches)"
        >
          CURVE · {curve.toUpperCase()}
        </button>
        <span className="xfade-keys">
          <span>▶ HOLD</span>
          <KeyHint code={right} />
        </span>
      </div>
    </div>
  );
}
