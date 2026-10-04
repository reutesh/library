/*
 * client/src/data/DataContext.tsx — shared reference data
 *
 * Holds the rooms / shelves / genres / authors used by the filter bars,
 * dropdowns and autocompletes across the app.  Fetched once after login;
 * views can request a silent refresh (keeps rendering existing data).
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type Room, type Shelf } from '../api';
import { useAuth } from '../auth/AuthContext';

interface DataContextValue {
  rooms: Room[];
  shelves: Shelf[];
  genres: string[];
  authors: string[];
  /** True once every reference dataset has loaded at least once. */
  referenceLoaded: boolean;
  /** Fetch rooms + shelves for every room (fresh book counts). */
  refreshRooms(): Promise<void>;
}

const DataContext = createContext<DataContextValue | undefined>(undefined);

export function DataProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [authors, setAuthors] = useState<string[]>([]);
  const [referenceLoaded, setReferenceLoaded] = useState(false);

  const fetchRoomsWithShelves = async (): Promise<{ rooms: Room[]; shelves: Shelf[] }> => {
    const roomsRes = await api.rooms();
    const shelvesRes = await Promise.all(roomsRes.map((r) => api.shelves(r.id)));
    return { rooms: roomsRes, shelves: shelvesRes.flat() };
  };

  const refreshRooms = async () => {
    const { rooms: nextRooms, shelves: nextShelves } = await fetchRoomsWithShelves();
    setRooms(nextRooms);
    setShelves(nextShelves);
  };

  useEffect(() => {
    if (!me) {
      setRooms([]);
      setShelves([]);
      setGenres([]);
      setAuthors([]);
      setReferenceLoaded(false);
      return;
    }
    let cancelled = false;

    const load = async () => {
      const [genresR, authorsR, roomsR] = await Promise.allSettled([
        api.genres(),
        api.authors(),
        fetchRoomsWithShelves(),
      ]);
      if (cancelled) return;
      if (genresR.status === 'fulfilled') setGenres(genresR.value);
      else console.error('load genres', genresR.reason);
      if (authorsR.status === 'fulfilled') setAuthors(authorsR.value);
      else console.error('load authors', authorsR.reason);
      if (roomsR.status === 'fulfilled') {
        setRooms(roomsR.value.rooms);
        setShelves(roomsR.value.shelves);
      } else {
        console.error('load rooms', roomsR.reason);
      }
      setReferenceLoaded(true);
    };
    load();

    return () => {
      cancelled = true;
    };
  }, [me]);

  return (
    <DataContext.Provider
      value={{ rooms, shelves, genres, authors, referenceLoaded, refreshRooms }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within a DataProvider');
  return ctx;
}