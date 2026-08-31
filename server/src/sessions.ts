/**
 * In-memory session store.
 *
 * Sessions intentionally do not survive a restart: sv2-ui is a single-process
 * app and re-authenticating after a restart is acceptable, which avoids
 * persisting bearer-equivalent secrets to disk.
 */

import { randomBytes } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'sv2_ui_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

type Session = { expiresAt: number };

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly now: () => number = Date.now) {}

  create(): string {
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, { expiresAt: this.now() + SESSION_TTL_MS });
    return token;
  }

  isValid(token: string | undefined): boolean {
    if (!token) return false;
    const session = this.sessions.get(token);
    if (!session) return false;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  destroy(token: string | undefined): void {
    if (token) this.sessions.delete(token);
  }

  /** Invalidate every session, e.g. after a reset. */
  destroyAll(): void {
    this.sessions.clear();
  }
}

/** Minimal cookie-header parser; avoids adding the cookie-parser dependency. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function buildSessionCookie(token: string, isSecure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  // Umbrel and LAN deployments are plain HTTP; marking the cookie Secure
  // unconditionally would make login silently impossible there.
  if (isSecure) attributes.push('Secure');
  return attributes.join('; ');
}

export function buildClearedSessionCookie(isSecure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
  ];
  if (isSecure) attributes.push('Secure');
  return attributes.join('; ');
}
