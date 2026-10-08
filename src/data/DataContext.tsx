/*
 * src/data/DataContext.tsx — shared reference data
 *
 * Holds the rooms / shelves / genres / authors used by the filter bars,
 * dropdowns and autocompletes across the app. Fetched once after login;
 * views call `refresh()` after changes (keeps rendering existing data).
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type Room, type Shelf } from '../api';
import { useAuth } from '../auth/AuthContext';

interface ReferenceData {
  rooms: Room[];
  shelves: Shelf[];
  genres: string[];
  authors: string[];
}

interface DataContextValue extends ReferenceData {
  /** True once the reference data has loaded at least once. */
  referenceLoaded: boolean;
  /** Re-fetch everything (e.g. fresh book counts, new genres). */
  refresh(): Promise<void>;
}

const EMPTY: ReferenceData = { rooms: [], shelves: [], genres: [], authors: [] };

const DataContext = createContext<DataContextValue | undefined>(undefined);

async function fetchReferenceData(): Promise<ReferenceData> {
  const [rooms, shelves, genres, authors] = await Promise.all([
    api.rooms(),
    api.shelves(),
    api.genres(),
    api.authors(),
  ]);
  return { rooms, shelves, genres, authors };
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const userId = me?.id;
  const [data, setData] = useState<ReferenceData>(EMPTY);
  const [referenceLoaded, setReferenceLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await fetchReferenceData());
    } catch (err) {
      console.error('load reference data', err);
    }
  }, []);

  useEffect(() => {
    setData(EMPTY);
    setReferenceLoaded(false);
    if (userId === undefined) return;

    let cancelled = false;
    fetchReferenceData()
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((err) => console.error('load reference data', err))
      .finally(() => {
        if (!cancelled) setReferenceLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <DataContext.Provider value={{ ...data, referenceLoaded, refresh }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within a DataProvider');
  return ctx;
}
