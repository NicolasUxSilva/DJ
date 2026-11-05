import { useEffect, useState } from 'react';

type LayoutMap = Map<string, string>;
interface KeyboardApi {
  getLayoutMap(): Promise<Iterable<[string, string]>>;
}

let cached: LayoutMap | null = null;
let pending: Promise<LayoutMap | null> | null = null;

function load(): Promise<LayoutMap | null> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    const kb = (navigator as Navigator & { keyboard?: KeyboardApi }).keyboard;
    pending = kb?.getLayoutMap
      ? kb
          .getLayoutMap()
          .then((m) => (cached = new Map(m)))
          .catch(() => null)
      : Promise.resolve(null);
  }
  return pending;
}

/** The user's real keyboard layout (Chromium only), so the legend shows their key labels. */
export function useLayoutMap(): LayoutMap | null {
  const [map, setMap] = useState<LayoutMap | null>(cached);
  useEffect(() => {
    if (!map) void load().then((m) => m && setMap(m));
  }, [map]);
  return map;
}
