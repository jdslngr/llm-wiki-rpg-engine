// Shared server-side shapes. The server now OWNS the wiki (Phase 2: persisted in
// Postgres, or in-memory in dev), so these types are used across the store, the
// engine, and the prompt assembly.

export type WikiFile = { frontmatter?: Record<string, unknown>; body?: string }
export type WikiMap = Record<string, WikiFile>
export type WikiUpdate = { file: string; field: string; value: unknown }
export type FactAddition = { file: string; text: string }
export type Turn = { role: 'player' | 'ai'; content: string }

// A whole playthrough's persisted state. The wiki holds the game state (incl.
// world-state.md's current_anchor + condition fields); history is the chat log.
export type Playthrough = {
  id: string
  character: string
  wiki: WikiMap
  history: Turn[]
  userId?: string  // Phase 3: the owning user (required for new playthroughs)
}

// Phase 3 — User Accounts
// Phase 5 adds BYOK/credits fields (hostedCredits seeded high for testers; metering built but not enforced).
export type User = {
  id: string
  username: string
  passwordHash: string
  keyMode: 'hosted' | 'byok'
  llmProvider: string | null     // user's own provider, if BYOK
  llmModel: string | null        // user's own model, if BYOK
  llmKeyEnc: string | null       // encrypted at rest, NEVER returned to client
  llmBaseUrl: string | null      // optional custom base URL (for openai-compatible providers)
  hostedCredits: number          // turns remaining on operator's key (metering built, not yet enforced)
  createdAt: Date
}

// Phase 5 — the fields a user can update in their settings (key is pre-encrypted by the route).
export type UserSettingsUpdate = {
  keyMode?: 'hosted' | 'byok'
  llmProvider?: string | null
  llmModel?: string | null
  llmKeyEnc?: string | null
  llmBaseUrl?: string | null
  hostedCredits?: number
}

export type Session = {
  id: string
  userId: string
  expiresAt: Date
  createdAt: Date
}

// Lightweight save-list entry returned to the client.
export type SaveEntry = {
  id: string
  character: string
  chapterNumber: number
  anchorTitle: string
  updatedAt: string
  turnCount: number
}
