/*
 * src/data/persistentState.ts — state that survives navigation
 *
 * Views unmount when you switch pages, which would throw away their
 * data and show the loading screen again on return. `usePersistentState`
 * works like `useState` but keeps the value in memory until the page is
 * reloaded or the user logs out, so returning to a view renders its last
 * data instantly while it re-fetches quietly in the background.
 */

import { useEffect, useState } from 'react';

const store = new Map<string, unknown>();

/** Forget everything (called on login / logout so users never see each other's data). */
export function clearPersistentState(): void {
  store.clear();
}

export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : initial));

  useEffect(() => {
    store.set(key, value);
  }, [key, value]);

  return [value, setValue] as const;
}
