import { createHash, randomBytes } from "node:crypto";

import type { PrismaRepository } from "../db/repository.js";

export const SESSION_COOKIE_NAME = "pk_session";
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export class SessionService {
  constructor(
    private readonly repository: PrismaRepository,
    private readonly options: {
      now(): Date;
      ttlMs: number;
      secure: boolean;
    },
  ) {}

  async rotate(accountId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.options.now().getTime() + this.options.ttlMs);
    await this.repository.rotateSession({ accountId, tokenHash: hashSessionToken(token), expiresAt });
    return { token, expiresAt };
  }

  async resolveToken(token: string | undefined) {
    if (!token) return null;
    return this.repository.findActiveSession(hashSessionToken(token), this.options.now());
  }

  async revoke(token: string | undefined): Promise<void> {
    if (token) await this.repository.deleteSession(hashSessionToken(token));
  }

  cookie(token: string): string {
    return serializeCookie(token, Math.floor(this.options.ttlMs / 1_000), this.options.secure);
  }

  clearCookie(): string {
    return serializeCookie("", 0, this.options.secure);
  }
}

export function readSessionToken(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name === SESSION_COOKIE_NAME) return part.slice(separator + 1).trim() || undefined;
  }
  return undefined;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function serializeCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
