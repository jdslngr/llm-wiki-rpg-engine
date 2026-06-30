// Phase 5 — encrypt/decrypt BYO API keys at rest.
// Uses AES-256-GCM with a key derived from the APP_SECRET env var.
// The encrypted key is stored in the DB; only the server (with APP_SECRET) can read it.
//
// IMPORTANT: back up APP_SECRET safely. If lost, every stored key becomes unreadable
// and users must re-enter them.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12   // standard for GCM
const TAG_LENGTH = 16  // GCM auth tag

function getSecret(): Buffer {
  const secret = process.env.APP_SECRET
  if (!secret) throw new Error('APP_SECRET is not set — cannot encrypt/decrypt keys. Set it in server/.env')
  // Derive a 32-byte key via SHA-256 (handles any-length passphrase).
  return createHash('sha256').update(secret).digest()
}

/** Encrypt a plaintext API key → base64 string (includes iv + auth tag). */
export function encryptKey(plaintext: string): string {
  const key = getSecret()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Layout: iv (12) + tag (16) + ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

/** Decrypt a base64 string back to the original API key. */
export function decryptKey(encoded: string): string {
  const key = getSecret()
  const buf = Buffer.from(encoded, 'base64')
  const iv = buf.subarray(0, IV_LENGTH)
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
