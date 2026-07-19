// Shared shapes between the browser and the backend's /api/play-turn.

export type WikiFile = { frontmatter?: Record<string, unknown>; body?: string }
export type WikiMap = Record<string, WikiFile>

export type Turn = { role: 'player' | 'ai'; content: string }

export type WikiUpdate = { file: string; field: string; value: unknown }

// The forced submit_turn shape the AI answers through (Game Plan §4).
export type SubmitTurn = {
  narrative: string
  suggested_actions: string[]
  events: string[]
  wiki_updates: WikiUpdate[]
}

// Phase 2: the server owns game state. These mirror the /api responses.
export type Dossier = {
  id: string
  name: string
  role: string
  knowsLabel: string
  dossier: string
  povLabel: string
}

export type WikiState = Record<string, Record<string, unknown>>

// What /api/new-game and /api/state return.
export type GameState = {
  playthroughId: string
  character: Dossier
  anchor: string
  // Human-readable labels for the header (server-provided; works across chapters).
  chapterNumber: number
  chapterTitle: string
  anchorTitle: string
  history: Turn[]
  actions: string[]
  wikiState: WikiState
  setting: string
}

// What /api/next-chapter returns: either the next chapter's GameState, or a signal that
// the whole story is finished.
export type NextChapterResponse = GameState | { complete: true }

// Authoring tool (admin) — mirrors server/src/chapters/defineChapter.ts.
export type Clause = { field: string; op: 'flag' | 'count_gte'; value?: number; hint?: string }
export type EndStateOp = { field: string; op: 'set' | 'append'; value: unknown }
export type ChapterSpec = {
  number: number
  title: string
  fragment: string
  anchors: { id: string; title: string; note: string; advanceWhen: Clause[] }[]
  events: { token: string; anchor: string; fold: { field: string; token?: string } }[]
  opening: { prose: string; actions: string[] }
  softLockThreshold?: number
  endState?: EndStateOp[]
  /** Marks this as the final chapter of the whole story (default false). */
  isFinal?: boolean
  /** Optional closing prose, shown on the recap screen only when isFinal and non-empty. */
  epilogue?: string
  /** Optional thank-you/credits text, independent of epilogue. */
  acknowledgment?: string
}
export type ChapterBrief = {
  number: number
  title: string
  beats: { title: string; whatHappens: string; conditionPlain: string }[]
  guardrails?: string
  openingHint?: string
  notes?: string
}
export type AuthoredChapterRow = {
  number: number
  spec: ChapterSpec
  title: string
  updatedAt: string
  updatedBy: string | null
}

// Phase 6: the chapter-end recap (GET /api/recap).
export type RecapCrew = { id: string; name: string; trust: number; arc: string }
export type RecapFacts = {
  chapterNumber: number
  chapterTitle: string
  characterName: string
  characterRole: string
  isVisitor: boolean
  beats: { id: string; title: string }[]
  crew: RecapCrew[]
  journey: {
    zonesVisited: string[]
    crewSpoken: string[]
    shipAreasExplored: string[]
    petInteracted: boolean
  }
  turnCount: number
  notableFacts?: { file: string; facts: string[] }[]
}
export type RecapResponse = {
  facts: RecapFacts
  hasNextChapter: boolean
  title: string
  prose: string
  /** Author-declared final chapter. */
  isFinal: boolean
  /** Author-written closing prose (only present when isFinal and non-empty). */
  epilogue?: string
  /** Author-written thank-you/credits (only present when isFinal and non-empty). */
  acknowledgment?: string
}

// Phase 6: recap-history API (GET /api/recaps, GET /api/recaps/:n).
export type RecapSummary = {
  chapterNumber: number
  chapterTitle: string
  title: string
  isFinal: boolean
  createdAt: string
  legacy?: true
}

export type RecapListResponse = {
  recaps: RecapSummary[]
}

/** Full detail entry from the recap-history API. Archive entries carry facts,
 *  finality, and closing fields; legacy entries carry only prose + chapter
 *  metadata and the legacy flag. */
export type RecapDetailEntry = {
  chapterNumber: number
  chapterTitle: string
  title: string
  prose: string
  facts?: RecapFacts
  isFinal: boolean
  epilogue?: string
  acknowledgment?: string
  createdAt: string
  legacy?: true
}

export type RecapDetailResponse = {
  recap: RecapDetailEntry
  legacy: boolean
}

// The trailing "done" frame from the /api/play-turn NDJSON stream.
export type DoneFrame = {
  type: 'done'
  narrative: string
  suggested_actions: string[]
  events: string[]
  wiki_updates: WikiUpdate[]
  anchor: string
  fromAnchor: string
  advanced: boolean
  chapterNumber: number
  chapterTitle: string
  anchorTitle: string
  wikiState: WikiState
  setting: string
}

// ── 16-bit art types ────────────────────────────────────────────────────────

export type ArtAsset = {
  id: string
  kind: 'chapter' | 'beat'
  chapterNumber: number
  anchor: string | null
  title: string
  label: string
  filename: string
  url: string
  mimeType: 'video/mp4' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/avif'
  sizeBytes: number
  updatedAt: string
  updatedBy: string | null
}

export type ChapterArtResponse = {
  chapterArt: ArtAsset | null
  beatArt: Record<string, ArtAsset>
}

export type ArtChapterOption = {
  number: number
  title: string
  anchors: { id: string; title: string }[]
}

export type ArtGalleryResponse = {
  chapters: {
    chapterNumber: number
    chapterTitle: string
    state: 'completed' | 'current'
    chapterArt: ArtAsset | null
    beatArts: { anchor: string; anchorTitle: string; art: ArtAsset | null }[]
  }[]
}
