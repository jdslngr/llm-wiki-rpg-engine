import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameState, RecapDetailEntry, RecapDetailResponse, RecapListResponse, RecapSummary } from './types'

interface Props {
  onResume: (state: GameState) => void
}

// ── Shared style helpers (mirror RecapScreen) ─────────────────────────────────

const fontTitle: React.CSSProperties = { fontFamily: "'Cinzel', Georgia, serif", letterSpacing: '0.04em' }
const fontBody: React.CSSProperties = { fontFamily: "'Lora', Georgia, serif" }

const goldBtn: React.CSSProperties = {
  background: 'linear-gradient(180deg, var(--color-gold) 0%, var(--color-gold-dark) 100%)',
  color: 'oklch(0.17 0.050 150)',
  fontFamily: "'Lora', Georgia, serif",
  letterSpacing: '0.06em',
  boxShadow: '0 2px 8px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,228,110,0.25)',
}

// Crew display-name fallbacks (mirror RecapScreen).
const CREW_NAMES: Record<string, string> = {
  kaspen: 'Kaspen',
  kaelen: 'Kaelen',
  pan: 'Pan',
  tariel: 'Tariel',
  rulan: 'Rulan',
}

function TrustBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="h-1.5 w-full overflow-hidden" style={{ background: 'var(--color-bg-input)' }}>
      <div
        className="h-full"
        style={{
          width: `${pct}%`,
          background: 'linear-gradient(to right, var(--color-gold-dark), oklch(0.80 0.050 78))',
        }}
      />
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RecapDetailView({
  detail,
  detailLegacy,
  onBack,
}: {
  detail: RecapDetailEntry
  detailLegacy: boolean
  onBack: () => void
}) {
  const facts = detail.facts

  return (
    <div className="mx-auto w-full max-w-2xl px-safe pb-48">
      {/* Back to list */}
      <button
        onClick={onBack}
        className="mt-6 text-sm text-gold-text hover:opacity-80 transition"
        style={fontBody}
      >
        ← All recaps
      </button>

      {/* Chapter header */}
      <div className="mt-6 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-text-muted" style={fontBody}>
          Chapter {detail.chapterNumber} Complete
        </p>
        <h1 className="mt-2 text-2xl font-medium text-text-primary sm:text-3xl" style={fontTitle}>
          {detail.chapterTitle}
        </h1>
        {detailLegacy && (
          <p className="mt-2 inline-block rounded-sm border px-2 py-0.5 text-[11px] text-text-dim" style={{ borderColor: 'var(--color-gold-mid)', ...fontBody }}>
            Prose-only (pre-archive save)
          </p>
        )}
      </div>

      {/* Prose */}
      <section className="mt-4">
        {detail.title && (
          <h2 className="mb-3 text-center text-lg font-medium italic text-text-primary" style={fontBody}>
            "{detail.title}"
          </h2>
        )}
        <div className="space-y-4 text-[15px] leading-relaxed text-text-body sm:text-base">
          {detail.prose.split(/\n{2,}/).map((para, i) => (
            <p key={i} className="whitespace-pre-wrap" style={fontBody}>
              {para.trim()}
            </p>
          ))}
        </div>
      </section>

      {/* Structured facts (archive entries only) */}
      {facts && (
        <>
          {/* Played-as line */}
          <p className="mt-6 text-center text-sm text-text-muted" style={fontBody}>
            Played as <span className="text-text-primary">{facts.characterName}</span>
            <span className="mx-1.5 text-text-dim">·</span>
            {facts.turnCount} turn{facts.turnCount !== 1 ? 's' : ''}
          </p>

          {/* Beats timeline */}
          <section className="mt-8">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted" style={fontBody}>
              Your journey
            </h3>
            <ol className="space-y-2">
              {facts.beats.map((b) => (
                <li key={b.id} className="flex items-center gap-3">
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center text-[11px]"
                    style={{ background: 'oklch(0.50 0.082 76 / 0.30)', color: 'var(--color-text-muted)' }}
                  >
                    ✓
                  </span>
                  <span className="text-sm text-text-primary" style={fontBody}>{b.title}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* Crew bonds */}
          {facts.crew.length > 0 && (
            <section className="mt-8">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted" style={fontBody}>
                Bonds formed
              </h3>
              <div className="space-y-3">
                {facts.crew.map((c) => (
                  <div key={c.id}>
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="text-sm text-text-primary" style={fontBody}>
                        {c.name || CREW_NAMES[c.id] || c.id}
                      </span>
                      <span className="text-xs text-text-dim" style={fontBody}>{c.trust}/100</span>
                    </div>
                    <TrustBar value={c.trust} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Final-chapter closing sections (archive entries only) */}
      {detail.isFinal && detail.epilogue && (
        <section className="mt-8">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted" style={fontBody}>
            Epilogue
          </h3>
          <div className="space-y-4 text-[15px] leading-relaxed text-text-body sm:text-base">
            {detail.epilogue.split(/\n{2,}/).map((para, i) => (
              <p key={i} className="whitespace-pre-wrap" style={fontBody}>
                {para.trim()}
              </p>
            ))}
          </div>
        </section>
      )}

      {detail.isFinal && detail.acknowledgment && (
        <section className="mt-8">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted" style={fontBody}>
            Acknowledgment
          </h3>
          <div className="space-y-4 text-[14px] leading-relaxed text-text-dim sm:text-[15px]">
            {detail.acknowledgment.split(/\n{2,}/).map((para, i) => (
              <p key={i} className="whitespace-pre-wrap" style={fontBody}>
                {para.trim()}
              </p>
            ))}
          </div>
        </section>
      )}

      {/* Bottom back button */}
      <div className="mt-10 text-center">
        <button
          onClick={onBack}
          className="text-sm text-gold-text hover:opacity-80 transition"
          style={fontBody}
        >
          ← All recaps
        </button>
      </div>
    </div>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function RecapHistoryScreen({ onResume }: Props) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [screen, setScreen] = useState<'list' | 'detail'>('list')
  const [summaries, setSummaries] = useState<RecapSummary[]>([])
  const [detail, setDetail] = useState<RecapDetailEntry | null>(null)
  const [detailLegacy, setDetailLegacy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [backLoading, setBackLoading] = useState(false)
  const [backError, setBackError] = useState('')

  // ── Race guards ────────────────────────────────────────────────────────────
  const nextIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const backIdRef = useRef(0)
  const backAbortRef = useRef<AbortController | null>(null)

  // ── Safe fetch helpers ─────────────────────────────────────────────────────

  /** Abort any in-flight request, bump the id, return a fresh controller + id. */
  function prepareFetch(abortRef: React.MutableRefObject<AbortController | null>, idRef: React.MutableRefObject<number>): { id: number; controller: AbortController } {
    abortRef.current?.abort()
    const id = ++idRef.current
    const controller = new AbortController()
    abortRef.current = controller
    return { id, controller }
  }

  // ── Load recap list ────────────────────────────────────────────────────────

  const loadList = useCallback(async () => {
    const { id, controller } = prepareFetch(abortRef, nextIdRef)
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/recaps', { signal: controller.signal })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Could not load recap history.')
      }
      const data: RecapListResponse = await res.json()
      if (id !== nextIdRef.current) return // stale
      setSummaries(data.recaps)
    } catch (err) {
      if (id !== nextIdRef.current) return // stale
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Could not load recap history.')
    } finally {
      if (id === nextIdRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadList()
    return () => { abortRef.current?.abort() }
  }, [loadList])

  // ── Load detail ────────────────────────────────────────────────────────────

  const openDetail = useCallback(async (chapterNumber: number) => {
    const { id, controller } = prepareFetch(abortRef, nextIdRef)
    setScreen('detail')
    setDetail(null)
    setDetailLoading(true)
    setDetailError('')
    try {
      const res = await fetch(`/api/recaps/${chapterNumber}`, { signal: controller.signal })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Could not load recap.')
      }
      const data: RecapDetailResponse = await res.json()
      if (id !== nextIdRef.current) return // stale
      setDetail(data.recap)
      setDetailLegacy(data.legacy)
    } catch (err) {
      if (id !== nextIdRef.current) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      setDetailError(err instanceof Error ? err.message : 'Could not load recap.')
    } finally {
      if (id === nextIdRef.current) setDetailLoading(false)
    }
  }, [])

  // ── Back to game ───────────────────────────────────────────────────────────

  const goBackToGame = useCallback(async () => {
    const { id, controller } = prepareFetch(backAbortRef, backIdRef)
    setBackLoading(true)
    setBackError('')
    try {
      const res = await fetch('/api/state', { signal: controller.signal })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Could not load game state.')
      }
      const fresh: GameState = await res.json()
      if (id !== backIdRef.current) return // stale
      // Navigate only after a successful fetch and state install.
      onResume(fresh)
    } catch (err) {
      if (id !== backIdRef.current) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      setBackError(err instanceof Error ? err.message : 'Could not return to game.')
    } finally {
      if (id === backIdRef.current) setBackLoading(false)
    }
  }, [onResume])

  // ── Helpers ────────────────────────────────────────────────────────────────

  const sorted = sort === 'newest' ? summaries : [...summaries].reverse()

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    } catch {
      return iso
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-[100svh]">
      {/* Soft top wash */}
      <div style={{ background: 'linear-gradient(to bottom, oklch(0.35 0.060 76 / 0.10), transparent)' }}>
        <div className="mx-auto w-full max-w-2xl px-safe pt-10 pb-4 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-text-muted" style={fontBody}>
            Your Story So Far
          </p>
          <h1 className="mt-2 text-2xl font-medium text-text-primary sm:text-3xl" style={fontTitle}>
            Recap History
          </h1>
        </div>
      </div>

      {/* Detail view */}
      {screen === 'detail' && detail && (
        <RecapDetailView detail={detail} detailLegacy={detailLegacy} onBack={() => { setScreen('list'); setDetail(null) }} />
      )}

      {/* Detail loading */}
      {screen === 'detail' && !detail && detailLoading && (
        <div className="py-16 text-center">
          <p className="animate-pulse text-sm text-text-muted" style={fontBody}>Loading recap…</p>
        </div>
      )}

      {/* Detail error */}
      {screen === 'detail' && !detail && detailError && (
        <div className="py-12 text-center">
          <p className="text-sm text-red-400">{detailError}</p>
          <button
            onClick={() => { setScreen('list'); setDetailError('') }}
            className="mt-4 rounded-sm border px-5 py-3 text-sm font-medium transition hover:opacity-80"
            style={{
              borderColor: 'var(--color-gold-mid)',
              color: 'var(--color-text-body)',
              fontFamily: "'Lora', Georgia, serif",
              background: 'oklch(0.40 0.070 76 / 0.12)',
            }}
          >
            ← Back to list
          </button>
        </div>
      )}

      {/* List view */}
      {screen === 'list' && (
        <div className="mx-auto w-full max-w-2xl px-safe pb-48">
          {loading ? (
            <div className="py-16 text-center">
              <p className="animate-pulse text-sm text-text-muted" style={fontBody}>Loading recap history…</p>
            </div>
          ) : error ? (
            <div className="py-12 text-center">
              <p className="text-sm text-red-400">{error}</p>
              <button
                onClick={loadList}
                className="mt-4 rounded-sm border px-5 py-3 text-sm font-medium transition hover:opacity-80"
                style={{
                  borderColor: 'var(--color-gold-mid)',
                  color: 'var(--color-text-body)',
                  fontFamily: "'Lora', Georgia, serif",
                  background: 'oklch(0.40 0.070 76 / 0.12)',
                }}
              >
                Try again
              </button>
            </div>
          ) : summaries.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-text-muted" style={fontBody}>No completed chapters yet.</p>
              <p className="mt-1 text-xs text-text-dim" style={fontBody}>Recaps appear here after you finish a chapter.</p>
            </div>
          ) : (
            <>
              {/* Sort toggle */}
              <div className="mb-6 flex items-center justify-between">
                <p className="text-xs text-text-muted" style={fontBody}>
                  {summaries.length} chapter{summaries.length !== 1 ? 's' : ''}
                </p>
                <button
                  onClick={() => setSort((s) => (s === 'newest' ? 'oldest' : 'newest'))}
                  className="rounded-sm border px-3 py-1.5 text-xs text-text-muted transition hover:opacity-80"
                  style={{ borderColor: 'var(--color-gold-mid)', fontFamily: "'Lora', Georgia, serif" }}
                >
                  {sort === 'newest' ? 'Newest first ▾' : 'Oldest first ▾'}
                </button>
              </div>

              {/* Summary cards */}
              <div className="space-y-3">
                {sorted.map((s) => (
                  <button
                    key={s.chapterNumber}
                    onClick={() => openDetail(s.chapterNumber)}
                    className="w-full rounded-sm border p-4 text-left transition hover:opacity-80"
                    style={{
                      borderColor: 'var(--color-gold-dim)',
                      background: 'var(--color-bg-card)',
                    }}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-text-primary" style={fontTitle}>
                        Chapter {s.chapterNumber}
                      </span>
                      <span className="shrink-0 text-[11px] text-text-muted" style={fontBody}>
                        {formatDate(s.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] text-text-muted" style={fontBody}>
                      {s.chapterTitle}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      {s.isFinal && (
                        <span
                          className="rounded-sm px-1.5 py-px text-[10px] uppercase tracking-wide"
                          style={{ background: 'oklch(0.50 0.082 76 / 0.25)', color: 'var(--color-gold-text)' }}
                        >
                          Final
                        </span>
                      )}
                      {s.legacy && (
                        <span
                          className="rounded-sm px-1.5 py-px text-[10px] uppercase tracking-wide"
                          style={{ background: 'oklch(0.40 0.070 76 / 0.15)', color: 'var(--color-text-dim)' }}
                        >
                          Legacy
                        </span>
                      )}
                    </div>
                    {s.title && (
                      <p className="mt-1 text-xs italic text-text-dim truncate" style={fontBody}>
                        "{s.title}"
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Sticky bottom bar — Back to Game */}
      <div
        className="fixed inset-x-0 bottom-0 border-t backdrop-blur pb-safe-room"
        style={{
          borderColor: 'var(--color-gold-dim)',
          background: 'oklch(0.188 0.058 152 / 0.95)',
        }}
      >
        <div className="mx-auto w-full max-w-2xl px-5 py-3">
          {backError && (
            <p className="mb-2 text-center text-xs text-red-400">{backError}</p>
          )}
          <button
            onClick={goBackToGame}
            disabled={backLoading}
            className="w-full rounded-sm px-5 py-3 text-sm font-semibold transition hover:opacity-90 disabled:opacity-50"
            style={goldBtn}
          >
            {backLoading ? 'Loading game…' : 'Back to Game'}
          </button>
        </div>
      </div>
    </div>
  )
}
