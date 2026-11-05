import { engine, keyboard } from '../state/controller';
import { findBinding, labelForCode, type Binding, type Group } from '../state/keymap';
import { useStore } from '../state/store';
import { useLayoutMap } from '../hooks/useLayoutMap';

const ROWS: Array<{ offset: number; keys: string[] }> = [
  { offset: 0, keys: ['Escape', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'] },
  { offset: 1.6, keys: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'] },
  { offset: 2.2, keys: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'] },
  { offset: 0, keys: ['ShiftLeft', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash', 'ShiftRight'] },
];

const TAG: Record<Group, string> = { deckA: 'A', deckB: 'B', mixer: 'X', pads: '', rec: 'R', global: '' };

/** Compact keyboard map. Keys light up while held; holding Shift reveals the volume layer. */
export function KeyLegend() {
  const pressed = useStore(keyboard.pressed, (s) => s.codes);
  const shift = useStore(keyboard.pressed, (s) => s.shift);
  const pads = useStore(engine.store, (s) => s.pads);
  const recording = useStore(engine.store, (s) => s.recording.active);
  const layout = useLayoutMap();

  const keyCap = (code: string) => {
    const isShift = code === 'ShiftLeft' || code === 'ShiftRight';
    const b: Binding | undefined = isShift ? undefined : findBinding(keyboard.bindings, code, shift);
    let short = b?.short ?? '';
    if (b?.action.kind === 'pad') short = pads[b.action.index]?.name ?? short;
    if (isShift) short = 'VOL LAYER';
    const group = b?.group ?? (isShift ? 'shift' : 'none');
    const on = !!pressed[code];
    const live = b?.action.kind === 'recStart' && recording;
    return (
      <div
        key={code}
        className={`kcap kcap--${group} ${on ? 'is-pressed' : ''} ${isShift ? 'kcap--wide' : ''} ${live ? 'is-live' : ''} ${b?.shift ? 'is-layer' : ''}`}
        title={b?.desc ?? (isShift ? 'Hold Shift: C/V and ,/. control deck volume' : undefined)}
      >
        <span className="kcap-key">{isShift ? '⇧' : labelForCode(code, layout)}</span>
        {b && TAG[b.group] && <span className="kcap-tag">{TAG[b.group]}</span>}
        <span className="kcap-fn">{short}</span>
      </div>
    );
  };

  return (
    <section className="legend" aria-label="Keyboard map">
      <div className="legend-head">
        <span className="panel-title">KEYBOARD</span>
        <span className="legend-note">
          HOLD = CONTINUOUS · BOTH KEYS OF A PAIR = RESET · <b>⇧</b> + BASS KEYS = VOLUME
        </span>
      </div>
      <div className="legend-keys">
        {ROWS.map((r, i) => (
          <div className="legend-row" key={i} style={{ paddingLeft: `${r.offset}rem` }}>
            {r.keys.map(keyCap)}
          </div>
        ))}
      </div>
    </section>
  );
}
