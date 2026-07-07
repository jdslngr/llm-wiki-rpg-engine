import { useEffect, useState } from 'react'
import type { GameState, NextChapterResponse, RecapResponse } from './types'

interface Props {
  onBackToSaves: () => void
  // Adopt the next chapter's fresh game state and return to play.
  onContinue: (state: GameState) => void
}

// Crew display names by id (fallback if the server name is missing).
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

export default function RecapScreen({ onBackToSaves, onContinue }: Props) {
  const [data, setData] = useState<RecapResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Continue-to-next-chapter state.
  const [continuing, setContinuing] = useState(false)
  const [continueError, setContinueError] = useState('')
  const [storyComplete, setStoryComplete] = useState(false)

  async function handleContinue() {
    setContinuing(true)
    setContinueError('')
    try {
      const res = await fetch('/api/next-chapter', { method: 'POST' })
      const body = (await res.json()) as NextChapterResponse | { error?: string }
      if (!res.ok) throw new Error(('error' in body && body.error) || 'Could not start the next chapter.')
      if ('complete' in body && body.complete) {
        setStoryComplete(true) // no further chapters — show the end-of-story state
      } else {
        onContinue(body as GameState)
      }
    } catch (err) {
      setContinueError(err instanceof Error ? err.message : 'Could not start the next chapter.')
    } finally {
      setContinuing(false)
    }
  }

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/recap')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Could not load the recap.')
      setData(body as RecapResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the recap.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const facts = data?.facts
  const fontTitle: React.CSSProperties = { fontFamily: "'Cinzel', Georgia, serif", letterSpacing: '0.04em' }
  const fontBody: React.CSSProperties = { fontFamily: "'Lora', Georgia, serif" }

  const goldBtn: React.CSSProperties = {
    background: 'linear-gradient(180deg, var(--color-gold) 0%, var(--color-gold-dark) 100%)',
    color: 'oklch(0.17 0.050 150)',
    fontFamily: "'Lora', Georgia, serif",
    letterSpacing: '0.06em',
    boxShadow: '0 2px 8px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,228,110,0.25)',
  }

  return (
    <div className="min-h-[100svh]">
      {/* Soft top wash to make this feel like a payoff moment. */}
      <div style={{ background: 'linear-gradient(to bottom, oklch(0.35 0.060 76 / 0.10), transparent)' }}>
        <div className="mx-auto w-full max-w-2xl px-safe pt-10 pb-4 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-text-muted" style={fontBody}>
            {facts ? `Chapter ${facts.chapterNumber} Complete` : '…'}
          </p>
          <h1 className="mt-2 text-2xl font-medium text-text-primary sm:text-3xl" style={fontTitle}>
            {facts ? facts.chapterTitle : '…'}
          </h1>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl px-safe pb-48">
        {loading ? (
          <div className="py-16 text-center">
            <p className="animate-pulse text-sm text-text-muted" style={fontBody}>Writing your recap…</p>
          </div>
        ) : error ? (
          <div className="py-12 text-center">
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={load}
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
        ) : data && facts ? (
          <>
            {/* The AI-written recap — the hero. */}
            <section className="mt-2">
              {data.title && (
                <h2 className="mb-3 text-center text-lg font-medium italic text-text-primary" style={fontBody}>
                  “{data.title}”
                </h2>
              )}
              <div className="space-y-4 text-[15px] leading-relaxed text-text-body sm:text-base">
                {data.prose.split(/\n{2,}/).map((para, i) => (
                  <p key={i} className="whitespace-pre-wrap" style={fontBody}>
                    {para.trim()}
                  </p>
                ))}
              </div>
            </section>

            {/* Played-as line. */}
            <p className="mt-6 text-center text-sm text-text-muted" style={fontBody}>
              Played as <span className="text-text-primary">{facts.characterName}</span>
              <span className="mx-1.5 text-text-dim">·</span>
              {facts.turnCount} turn{facts.turnCount !== 1 ? 's' : ''}
            </p>

            {/* Beats timeline. */}
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

            {/* Crew bonds. */}
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
        ) : null}
      </div>

      {/* Sticky bottom action bar — thumb-reachable on mobile. */}
      <div
        className="fixed inset-x-0 bottom-0 border-t backdrop-blur pb-safe-room"
        style={{
          borderColor: 'var(--color-gold-dim)',
          background: 'oklch(0.188 0.058 152 / 0.95)',
        }}
      >
        <div className="mx-auto w-full max-w-2xl px-5 py-3">
          {storyComplete ? (
            <>
              <p className="mb-3 text-center text-sm text-text-muted" style={fontBody}>
                You've reached the end of the story so far. Thank you for playing.
              </p>
              <button
                onClick={onBackToSaves}
                className="w-full rounded-sm px-5 py-3 text-sm font-semibold transition hover:opacity-90"
                style={goldBtn}
              >
                Back to Your Stories
              </button>
            </>
          ) : data?.hasNextChapter ? (
            <>
              <button
                onClick={handleContinue}
                disabled={continuing}
                className="w-full rounded-sm px-5 py-3 text-sm font-semibold transition hover:opacity-90 disabled:opacity-50"
                style={goldBtn}
              >
                {continuing ? 'Opening the next chapter…' : `Continue to Chapter ${facts!.chapterNumber + 1} →`}
              </button>
              {continueError && (
                <p className="mt-2 text-center text-xs text-red-400">{continueError}</p>
              )}
              <button
                onClick={onBackToSaves}
                className="mt-2 w-full px-5 py-2.5 text-xs font-medium text-text-muted transition hover:text-text-primary"
                style={fontBody}
              >
                Back to Your Stories
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onBackToSaves}
                className="w-full rounded-sm px-5 py-3 text-sm font-semibold transition hover:opacity-90"
                style={goldBtn}
              >
                Back to Your Stories
              </button>
              <p className="mt-2 text-center text-xs text-text-dim" style={fontBody}>More chapters coming soon</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
