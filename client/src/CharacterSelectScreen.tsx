import { useState } from 'react'
import type { GameState } from './types'
import { CHARACTER_CARDS } from './characterCards'

interface Props {
  onStart: (state: GameState) => void
  onBack: () => void
}

export default function CharacterSelectScreen({ onStart, onBack }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  // Visitor name — only shown when the Visitor card is expanded.
  const [visitorExpanded, setVisitorExpanded] = useState(false)
  const [visitorName, setVisitorName] = useState('')

  async function pick(characterId: string, name?: string) {
    setBusyId(characterId)
    setError('')
    try {
      const body: Record<string, string> = { character: characterId }
      if (name && name.trim()) body.visitorName = name.trim()
      const res = await fetch('/api/new-game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not start a new game.')
      onStart(data as GameState)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start a new game.')
    } finally {
      setBusyId(null)
    }
  }

  function handleCardClick(card: (typeof CHARACTER_CARDS)[number]) {
    if (busyId) return
    if (card.id === 'visitor') {
      // Expand the Visitor card to show the name field.
      if (!visitorExpanded) {
        setVisitorExpanded(true)
        return
      }
      // Already expanded — submit with the name.
      pick(card.id, visitorName || undefined)
    } else {
      pick(card.id)
    }
  }

  const fontTitle: React.CSSProperties = { fontFamily: "'Cinzel', Georgia, serif", letterSpacing: '0.04em' }
  const fontBody: React.CSSProperties = { fontFamily: "'Lora', Georgia, serif" }

  const goldBtn = (): React.CSSProperties => ({
    background: 'linear-gradient(180deg, var(--color-gold) 0%, var(--color-gold-dark) 100%)',
    color: 'oklch(0.17 0.050 150)',
    fontFamily: "'Lora', Georgia, serif",
    boxShadow: '0 2px 8px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,228,110,0.25)',
  })

  const ghostBtn: React.CSSProperties = {
    borderColor: 'var(--color-gold-mid)',
    color: 'var(--color-text-body)',
    fontFamily: "'Lora', Georgia, serif",
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-5xl">
        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h1 className="text-[26px] font-medium text-text-primary" style={fontTitle}>Choose Your Story</h1>
          </div>
          <button
            onClick={onBack}
            disabled={busyId !== null}
            className="text-sm text-gold-text hover:opacity-80 transition disabled:opacity-50"
            style={fontBody}
          >
            ← Back to saves
          </button>
        </div>

        {error && (
          <div className="mb-4 border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400 rounded-sm">
            {error}
          </div>
        )}

        {/* Card grid — 3 columns on desktop, 2 on tablet, 1 on mobile */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CHARACTER_CARDS.map((card) => {
            const isBusy = busyId === card.id
            const otherBusy = busyId !== null && busyId !== card.id
            const isVisitor = card.id === 'visitor'

            return (
              <div
                key={card.id}
                className={`flex flex-col rounded-sm border p-6 transition ${
                  otherBusy ? 'opacity-40' : ''
                }`}
                style={{
                  background: 'var(--color-bg-card)',
                  borderColor: isVisitor && visitorExpanded ? 'var(--color-gold-border)' : 'var(--color-gold-mid)',
                  boxShadow: isVisitor && visitorExpanded ? '0 0 0 1px var(--color-gold-border)' : undefined,
                }}
              >
                {/* Emoji + name */}
                <div className="flex items-center gap-3">
                  <span className="text-3xl" role="img" aria-label={card.name}>
                    {card.emoji}
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-lg font-medium text-text-primary" style={fontTitle}>{card.name}</h2>
                    <p className="text-xs text-text-muted" style={fontBody}>{card.position}</p>
                  </div>
                </div>

                {/* Summary */}
                <p className="mt-4 flex-1 text-sm leading-relaxed text-text-body" style={fontBody}>{card.summary}</p>

                {/* Gear */}
                <p className="mt-3 text-xs text-text-muted" style={fontBody}>
                  <span className="text-text-dim">Gear: </span>
                  {card.gear}
                </p>

                {/* Visitor name field — appears on first click */}
                {isVisitor && visitorExpanded && (
                  <div className="mt-4">
                    <label className="block text-xs text-text-muted" style={fontBody}>
                      Your name{' '}
                      <span className="text-text-dim">(or leave blank for &ldquo;the Visitor&rdquo;)</span>
                    </label>
                    <input
                      type="text"
                      value={visitorName}
                      onChange={(e) => setVisitorName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') pick(card.id, visitorName || undefined)
                      }}
                      placeholder="What should the crew call you?"
                      maxLength={30}
                      autoFocus
                      className="mt-1 w-full rounded-sm border px-3 py-3 text-sm text-text-primary placeholder:text-text-dim/70 transition disabled:opacity-50"
                      style={{
                        background: 'var(--color-bg-input)',
                        borderColor: 'var(--color-gold-mid)',
                        fontFamily: "'Lora', Georgia, serif",
                      }}
                    />
                  </div>
                )}

                {/* Action button */}
                <button
                  onClick={() => handleCardClick(card)}
                  disabled={otherBusy}
                  className={`mt-4 w-full rounded-sm px-5 py-3 text-sm font-medium transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${
                    isVisitor && visitorExpanded
                      ? 'font-semibold'
                      : ''
                  }`}
                  style={
                    isVisitor && visitorExpanded
                      ? goldBtn()
                      : { ...ghostBtn, background: 'oklch(0.40 0.070 76 / 0.12)', border: '1px solid var(--color-gold-mid)' }
                  }
                >
                  {isBusy
                    ? 'Starting…'
                    : isVisitor && !visitorExpanded
                      ? 'Play as the Visitor'
                      : isVisitor
                        ? visitorName.trim()
                          ? `Start as ${visitorName.trim()}`
                          : 'Start as the Visitor'
                        : `Play as ${card.name}`}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
