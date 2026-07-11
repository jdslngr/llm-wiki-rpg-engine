import { useEffect, useState } from 'react'
import type { GameState } from './types'

// Display labels for character IDs.
const CHAR_NAMES: Record<string, string> = {
  kaspen: 'Kaspen',
  kaelen: 'Kaelen',
  pan: 'Pan',
  tariel: 'Tariel',
  rulan: 'Rulan',
  visitor: 'the Visitor',
}

export type SaveEntry = {
  id: string
  character: string
  chapterNumber: number
  anchorTitle: string
  updatedAt: string
  turnCount: number
}

interface Props {
  onResume: (state: GameState) => void
  onStartNew: () => void
  onSettings: () => void
  onLogout: () => void
  onAuthor: () => void
  onManageArt: () => void
  onChapterArt: (playthroughId: string) => void
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function SavesScreen({ onResume, onStartNew, onSettings, onLogout, onAuthor, onManageArt, onChapterArt }: Props) {
  const [saves, setSaves] = useState<SaveEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setIsAdmin(!!d?.user?.isAdmin))
      .catch(() => {})
  }, [])

  async function loadSaves() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/saves')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not load saves.')
      setSaves(data.saves ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load saves.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSaves()
  }, [])

  async function resume(id: string) {
    setBusyId(id)
    setError('')
    try {
      const res = await fetch(`/api/saves/${id}/resume`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not resume save.')
      onResume(data as GameState)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resume save.')
    } finally {
      setBusyId(null)
    }
  }

  function startNew() {
    onStartNew()
  }

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      /* best-effort */
    }
    onLogout()
  }

  const fontTitle: React.CSSProperties = { fontFamily: "'Cinzel', Georgia, serif", letterSpacing: '0.04em' }
  const fontBody: React.CSSProperties = { fontFamily: "'Lora', Georgia, serif" }

  return (
    <div className="flex min-h-[100svh] items-center justify-center p-4">
      <div
        className="w-full max-w-[700px] rounded p-[36px_40px_32px]"
        style={{
          background: 'linear-gradient(155deg, oklch(0.265 0.046 149), oklch(0.235 0.050 152))',
          boxShadow: '0 28px 72px rgba(0,0,0,0.55), 0 8px 24px rgba(0,0,0,0.36), 0 0 0 1px var(--color-gold-border), inset 0 1px 0 rgba(255,220,80,0.10)',
        }}
      >
        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h1 className="text-[26px] font-medium text-text-primary" style={fontTitle}>
            Your Stories
          </h1>
          <div className="flex items-center gap-4 flex-wrap">
            {isAdmin && (
              <button
                onClick={onAuthor}
                className="text-sm text-gold-text hover:opacity-80 transition"
                style={fontBody}
              >
                ✎ Author a chapter
              </button>
            )}
            {isAdmin && (
              <button
                onClick={onManageArt}
                className="text-sm text-gold-text hover:opacity-80 transition"
                style={fontBody}
              >
                🎨 Manage art
              </button>
            )}
            <span className="text-text-muted" style={fontBody}>·</span>
            <button
              onClick={onSettings}
              className="text-sm text-gold-text hover:opacity-80 transition"
              style={fontBody}
            >
              Settings
            </button>
            <span className="text-text-muted" style={fontBody}>·</span>
            <button
              onClick={handleLogout}
              className="text-sm text-gold-text hover:opacity-80 transition"
              style={fontBody}
            >
              Log out
            </button>
          </div>
        </div>

        {error && <div className="mb-4 text-sm text-red-400">{error}</div>}

        {loading ? (
          <p className="text-sm text-text-muted" style={fontBody}>Loading your saves…</p>
        ) : saves.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-text-muted" style={fontBody}>No adventures yet.</p>
            <p className="mt-1 text-xs text-text-dim" style={fontBody}>Start your first chapter below.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {saves.map((s) => (
              <div
                key={s.id}
                className="flex items-start justify-between rounded-sm border p-[16px_20px]"
                style={{
                  background: 'var(--color-bg-card)',
                  borderColor: 'var(--color-gold-mid)',
                }}
              >
                <div className="min-w-0">
                  <p className="text-[17px] font-medium text-text-primary" style={fontBody}>
                    {CHAR_NAMES[s.character] ?? s.character}
                  </p>
                  <p className="mt-1 text-[13px] text-text-muted" style={fontBody}>
                    Chapter {s.chapterNumber} · {s.anchorTitle}
                    <span className="mx-1.5 text-text-dim">·</span>
                    {timeAgo(s.updatedAt)}
                    <span className="mx-1.5 text-text-dim">·</span>
                    {s.turnCount} turn{s.turnCount !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onChapterArt(s.id)}
                    className="rounded-sm px-3 py-2 text-[12px] font-medium transition hover:opacity-80"
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-gold-mid)',
                      color: 'var(--color-gold-text)',
                      fontFamily: "'Lora', Georgia, serif",
                    }}
                  >
                    Chapter Art
                  </button>
                  <button
                    onClick={() => resume(s.id)}
                    disabled={busyId !== null}
                    className="rounded-sm px-[22px] py-2 text-[13px] font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      background: 'linear-gradient(180deg, var(--color-gold) 0%, var(--color-gold-dark) 100%)',
                      color: 'oklch(0.17 0.050 150)',
                      fontFamily: "'Lora', Georgia, serif",
                      boxShadow: '0 2px 8px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,228,110,0.25)',
                    }}
                  >
                    {busyId === s.id ? 'Loading…' : 'Continue'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Divider */}
        <div
          className="mt-6 mb-4 border-t"
          style={{ borderColor: 'var(--color-gold-mid)' }}
        />

        <button
          onClick={startNew}
          className="w-full h-12 rounded-sm border text-sm font-medium transition hover:opacity-80"
          style={{
            background: 'transparent',
            borderColor: 'var(--color-gold-mid)',
            color: 'var(--color-gold-text)',
            fontFamily: "'Lora', Georgia, serif",
            letterSpacing: '0.04em',
          }}
        >
          + New Game
        </button>
      </div>
    </div>
  )
}
