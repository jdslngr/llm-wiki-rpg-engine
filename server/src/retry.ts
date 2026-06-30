// Phase 6 — resilience constants for the AI turn.
//
// The AI SDK already retries transient request-init errors (rate limits, brief
// "overloaded" responses) with exponential backoff. We make that explicit and
// add a hard timeout so a hung provider fails cleanly instead of hanging the
// player's turn forever.

/** How many times the AI SDK retries a transient failure before giving up. */
export const MAX_TURN_RETRIES = 2

/** Hard cap on a single turn's AI call. Past this we abort and surface an error. */
export const STREAM_TIMEOUT_MS = 75_000

/** A warm, in-world message shown to the player when a turn fails. */
export const FRIENDLY_TURN_ERROR =
  'The storyteller stumbled. Your progress is safe — please try again.'

// Context Bounding Upgrade §3.1 — how many recent exchanges (player+ai pairs) of the
// CURRENT chapter are sent to the model each turn. Earlier chapters are carried via
// chapter-log.md instead of raw turns (§3.2), so this stays flat regardless of save length.
export const MODEL_WINDOW_TURNS = 14
