import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get(): T;
  set(partial: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
}

/** Minimal external store. Components subscribe to slices with useStore(selector). */
export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(partial) {
      const next = typeof partial === 'function' ? partial(state) : partial;
      state = { ...state, ...next };
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Selectors must return stable references (state slices or primitives). */
export function useStore<T, S>(store: Store<T>, selector: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}
