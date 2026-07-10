// Phase 3 — Auth utilities and middleware.
// Uses bcryptjs for password hashing and session tokens (random UUIDs) for login
// sessions. Simpler than JWT: logout = delete the row, same pattern as the pid cookie.

import { hash, compare } from 'bcryptjs'
import type { Request, Response, NextFunction } from 'express'
import type { PlaythroughStore } from './store.js'

const SALT_ROUNDS = 12

// Cookie that carries the session token. Same shape as the pid cookie.
export const SID_COOKIE = 'sid'
export const SID_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  path: '/',
  secure: process.env.COOKIE_SECURE === 'true',
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, SALT_ROUNDS)
}

export async function verifyPassword(password: string, hashed: string): Promise<boolean> {
  return compare(password, hashed)
}

// --- Validation (server-side, mirrors what the client hints at) -------------

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/

export function validateUsername(username: unknown): string | null {
  if (typeof username !== 'string') return 'Username is required.'
  const trimmed = username.trim()
  if (trimmed.length < 3 || trimmed.length > 30) return 'Username must be 3–30 characters.'
  if (!USERNAME_RE.test(trimmed)) return 'Username may only contain letters, numbers, and underscores.'
  return null // ok
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string') return 'Password is required.'
  if (password.length < 8) return 'Password must be at least 8 characters.'
  return null // ok
}

// --- Middleware --------------------------------------------------------------

// Augment Express's Request so downstream handlers see who's logged in.
declare global {
  namespace Express {
    interface Request {
      userId?: string
    }
  }
}

/**
 * Express middleware that resolves the `sid` cookie to a user. If the cookie is
 * missing, expired, or invalid, it replies 401 and does NOT call next().
 *
 * Usage:
 *   app.get('/api/protected', requireAuth(store), (req, res) => { ... })
 */
export function requireAuth(store: PlaythroughStore) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[SID_COOKIE]
    if (!token) {
      res.status(401).json({ error: 'Not logged in.' })
      return
    }
    const session = await store.getSession(token)
    if (!session) {
      res.status(401).json({ error: 'Session expired. Please log in again.' })
      return
    }
    req.userId = session.userId
    next()
  }
}

// --- Admin -------------------------------------------------------------------
// Admins are an env allowlist of usernames (ADMIN_USERNAMES, comma-separated). Keeps it
// simple: no role column, no UI to manage roles. The authoring tool is gated on this.
export function isAdminUsername(username: string): boolean {
  const list = (process.env.ADMIN_USERNAMES ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return list.includes(username.toLowerCase())
}

/**
 * Express middleware requiring an ADMIN user. Mount AFTER requireAuth (it relies on
 * req.userId). Replies 403 for logged-in non-admins.
 */
export function requireAdmin(store: PlaythroughStore) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
      res.status(401).json({ error: 'Not logged in.' })
      return
    }
    const user = await store.getUserById(req.userId)
    if (!user || !isAdminUsername(user.username)) {
      res.status(403).json({ error: 'Admin access required.' })
      return
    }
    next()
  }
}
