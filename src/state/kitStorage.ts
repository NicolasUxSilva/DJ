/**
 * Persists the user's drum kit (imported samples + pad volumes) in IndexedDB so a
 * custom kit survives reloads. Default synthesized pads store only their volume.
 */
export interface StoredPad {
  index: number;
  volume: number;
  name?: string;
  fileName?: string;
  mime?: string;
  data?: ArrayBuffer;
}

const DB = 'rhythm';
const STORE = 'kit';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'index' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      resolve(req ? req.result : undefined);
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
  });
}

export async function loadStoredKit(): Promise<StoredPad[]> {
  try {
    return ((await tx('readonly', (s) => s.getAll())) as StoredPad[]) ?? [];
  } catch {
    return [];
  }
}

export async function savePad(pad: StoredPad): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put(pad));
  } catch {
    /* ignore — persistence is best effort */
  }
}

export async function clearStoredKit(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.clear());
  } catch {
    /* ignore */
  }
}

// ── kit files (.rhythmkit.json) ─────────────────────────────────────────────

export interface KitFile {
  format: 'rhythm-kit';
  version: 1;
  name: string;
  pads: Array<{ index: number; name: string; volume: number; fileName: string | null; mime: string | null; data: string | null }>;
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function fromBase64(b64: string): ArrayBuffer {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

export function isKitFile(v: unknown): v is KitFile {
  return !!v && typeof v === 'object' && (v as KitFile).format === 'rhythm-kit' && Array.isArray((v as KitFile).pads);
}
