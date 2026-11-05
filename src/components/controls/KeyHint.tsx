import { keyboard } from '../../state/controller';
import { useKeyPressed } from '../../state/KeyboardController';
import { labelForCode } from '../../state/keymap';
import { useLayoutMap } from '../../hooks/useLayoutMap';

/** Small key-cap badge that lights up while its key is held. */
export function KeyHint({ code, shift }: { code: string | null; shift?: boolean }) {
  const pressed = useKeyPressed(keyboard, code);
  const layout = useLayoutMap();
  if (!code) return null;
  return (
    <kbd className={`keyhint ${pressed ? 'is-pressed' : ''}`}>
      {shift ? '⇧' : ''}
      {labelForCode(code, layout)}
    </kbd>
  );
}
