/*
 * src/roles.ts — role labels and client-side permission checks
 *
 * These mirror the rules enforced in server/routes.ts and only decide
 * which buttons to show; the server remains the source of truth.
 */

import type { Book, Me, Role } from './api';

export const roleLabels: Record<Role, string> = {
  admin: 'מנהל',
  editor: 'עורך',
  viewer: 'צופה',
};

export function canEditRoom(me: Me | null, roomId: number | null): boolean {
  if (me?.role === 'admin') return true;
  return me?.role === 'editor' && roomId != null && me.allowedRoomIds.includes(roomId);
}

export function canEditBook(me: Me | null, book: Book): boolean {
  if (me?.role === 'admin') return true;
  if (book.status === 'pending' && book.createdBy === me?.id) return true;
  return canEditRoom(me, book.roomId);
}

export function canLend(me: Me | null): boolean {
  return me?.role === 'admin' || me?.role === 'editor';
}
