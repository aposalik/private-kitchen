import type { PlayerRole } from "@cooking-game/shared";

interface Ticket {
  role: PlayerRole;
  expiresAt: number;
}

const store = new Map<string, Ticket>();

export function createTicket(role: PlayerRole, ttlMs = 30_000): string {
  const id =
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  store.set(id, { role, expiresAt: Date.now() + ttlMs });
  return id;
}

export function consumeTicket(id: string): PlayerRole | undefined {
  const ticket = store.get(id);
  if (!ticket) return undefined;
  store.delete(id);
  if (ticket.expiresAt < Date.now()) return undefined;
  return ticket.role;
}
