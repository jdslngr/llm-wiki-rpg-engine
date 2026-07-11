import { useEffect, useState } from 'react'
import type { ArtAsset, ArtGalleryResponse } from './types'

interface Props {
  playthroughId: string
  onBack: () => void
}

type GalleryChapter = ArtGalleryResponse['chapters'][number]

// ── Shared UI tokens (match AuthoringScreen / ArtAdminScreen) ────────────────

const fontTitle: React.CSSProperties = { fontFamily: "'Cinzel', Georgia, serif", letterSpacing: '0.04em' }
const fontBody: React.CSSProperties = { fontFamily: "'Lora', Georgia, serif" }

const ghostBtn = 'border rounded-sm px-3 py-2 text-xs transition hover:opacity-80 disabled:opacity-50'
const ghostBtnStyle: React.CSSProperties = {
  borderColor: 'var(--color-gold-mid)',
  color: 'var(--color-gold-text)',
  fontFamily: "'Lora', Georgia, serif",
}

export default function ChapterArtScreen({ playthroughId, onBack }: Props) {
  const [gallery, setGallery] = useState<ArtGalleryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Navigation
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [selectedChapter, setSelectedChapter] = useState<GalleryChapter | null>(null)

  // Full-screen overlay
  const [overlay, setOverlay] = useState<ArtAsset | null>(null)

  // ── Fetch gallery ──────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(`/api/art/gallery/${encodeURIComponent(playthroughId)}`)
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(data.error ?? 'Could not load gallery.')
        setGallery(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load gallery.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [playthroughId])

  // ── Open detail / overlay ──────────────────────────────────────────────────

  function openDetail(chapter: GalleryChapter) {
    setSelectedChapter(chapter)
    setView('detail')
  }

  function backToList() {
    setView('list')
    setSelectedChapter(null)
    setOverlay(null)
  }

  function closeOverlay() {
    setOverlay(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const chapters = gallery?.chapters ?? []

  return (
    <div className="min-h-[100svh]">
      {/* Header bar */}
      <header
        className="flex items-center justify-between gap-3 px-8 py-0 border-b"
        style={{
          background: 'var(--color-bg-nav)',
          borderColor: 'var(--color-gold-dim)',
          boxShadow: '0 2px 16px rgba(0,0,0,0.28)',
          height: '62px',
        }}
      >
        <div>
          <h1 className="text-[15px] font-medium text-text-primary" style={fontTitle}>
            {view === 'list' ? 'Chapter Art' : selectedChapter?.chapterTitle ?? 'Chapter Art'}
          </h1>
          <p className="text-xs italic text-text-muted mt-1" style={fontBody}>
            {view === 'list' ? 'Per-save art gallery' : `Chapter ${selectedChapter?.chapterNumber}`}
          </p>
        </div>
        <button
          onClick={view === 'list' ? onBack : backToList}
          className={ghostBtn}
          style={ghostBtnStyle}
        >
          {view === 'list' ? '← Your Stories' : '← All Chapters'}
        </button>
      </header>

      <div className="mx-auto w-full max-w-[860px] px-5 py-5">
        {/* Error */}
        {error && (
          <div className="mb-4 border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-400 rounded-sm">{error}</div>
        )}

        {/* Loading */}
        {loading && (
          <p className="text-sm text-text-muted" style={fontBody}>Loading gallery…</p>
        )}

        {/* Empty */}
        {!loading && !error && chapters.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-sm text-text-muted" style={fontBody}>No chapters reached yet.</p>
            <p className="mt-1 text-xs text-text-dim" style={fontBody}>
              Art will appear here as you progress through the story.
            </p>
          </div>
        )}

        {/* ── LIST VIEW ──────────────────────────────────────────────────── */}
        {!loading && !error && view === 'list' && chapters.length > 0 && (
          <div className="space-y-3">
            {chapters.map((ch) => {
              const totalArts =
                (ch.chapterArt ? 1 : 0) + ch.beatArts.filter((b) => b.art).length
              return (
                <button
                  key={ch.chapterNumber}
                  onClick={() => openDetail(ch)}
                  className="w-full text-left rounded-sm border p-[20px_24px] transition hover:opacity-90"
                  style={{
                    background: 'var(--color-bg-card)',
                    borderColor: 'var(--color-gold-mid)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[17px] font-medium text-text-primary" style={fontBody}>
                        Chapter {ch.chapterNumber} — {ch.chapterTitle}
                      </p>
                      <p className="mt-1 text-xs text-text-muted" style={fontBody}>
                        {ch.state === 'completed' ? 'Completed' : 'In progress'} · {totalArts} art{totalArts !== 1 ? 's' : ''} uploaded
                      </p>
                    </div>
                    <span className="text-gold-text text-sm" style={fontBody}>View →</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* ── DETAIL VIEW ────────────────────────────────────────────────── */}
        {!loading && !error && view === 'detail' && selectedChapter && (
          <div className="space-y-5">
            {/* Chapter art */}
            {selectedChapter.chapterArt ? (
              <ArtCard
                art={selectedChapter.chapterArt}
                label="Chapter Art"
                onClick={() => setOverlay(selectedChapter.chapterArt)}
              />
            ) : (
              <div
                className="rounded-sm border p-[24px_28px] text-center"
                style={{
                  background: 'var(--color-bg-card)',
                  borderColor: 'var(--color-gold-mid)',
                }}
              >
                <p className="text-sm text-text-muted" style={fontBody}>No chapter art uploaded yet.</p>
              </div>
            )}

            {/* Beat art */}
            {selectedChapter.beatArts.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-text-primary mb-3" style={fontTitle}>
                  Beat Art
                </h2>
                <div className="space-y-3">
                  {selectedChapter.beatArts.map(({ anchor, anchorTitle, art }) => (
                    <div key={anchor}>
                      <p className="text-xs text-text-muted mb-1 uppercase tracking-[0.08em]" style={fontBody}>
                        {anchor} — {anchorTitle}
                      </p>
                      {art ? (
                        <ArtCard
                          art={art}
                          label={`${anchor} — ${anchorTitle}`}
                          onClick={() => setOverlay(art)}
                        />
                      ) : (
                        <div
                          className="rounded-sm border p-[16px_20px]"
                          style={{
                            background: 'var(--color-bg-card)',
                            borderColor: 'var(--color-gold-mid)',
                          }}
                        >
                          <p className="text-xs text-text-dim italic" style={fontBody}>No art for this beat.</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── FULL-SCREEN OVERLAY ──────────────────────────────────────────── */}
      {overlay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85"
          onClick={closeOverlay}
        >
          <button
            onClick={closeOverlay}
            className="absolute top-4 right-4 z-10 rounded-sm border px-3 py-2 text-xs transition hover:opacity-80"
            style={{
              borderColor: 'var(--color-gold-mid)',
              color: 'var(--color-gold-text)',
              background: 'rgba(0,0,0,0.6)',
              fontFamily: "'Lora', Georgia, serif",
            }}
          >
            ✕ Close
          </button>

          <div
            className="max-h-[90svh] max-w-[90vw] flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {overlay.mimeType.startsWith('image/') ? (
              <img
                src={overlay.url}
                alt={overlay.label}
                className="max-h-[90svh] max-w-[90vw] object-contain rounded-sm"
              />
            ) : (
              <video
                src={overlay.url}
                autoPlay
                muted
                loop
                playsInline
                controls
                className="max-h-[90svh] max-w-[90vw] rounded-sm"
              />
            )}
          </div>

          <p
            className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-white/80"
            style={{ fontFamily: "'Lora', Georgia, serif" }}
          >
            {overlay.label}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Reusable art card (thumbnail + label) ────────────────────────────────────

function ArtCard({
  art,
  label,
  onClick,
}: {
  art: ArtAsset
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-sm border overflow-hidden transition hover:opacity-90"
      style={{
        background: 'var(--color-bg-card)',
        borderColor: 'var(--color-gold-mid)',
      }}
    >
      <div className="flex items-center gap-4 p-[16px_20px]">
        {/* Thumbnail */}
        <div
          className="w-[90px] shrink-0 rounded-sm overflow-hidden"
          style={{ aspectRatio: '9/16' }}
        >
          {art.mimeType.startsWith('image/') ? (
            <img
              src={art.url}
              alt={art.label}
              className="w-full h-full object-cover"
            />
          ) : (
            <video
              src={art.url}
              muted
              loop
              playsInline
              className="w-full h-full object-cover"
            />
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-text-primary" style={{ fontFamily: "'Lora', Georgia, serif" }}>
            {art.label}
          </p>
          <p className="text-xs text-text-muted mt-1" style={{ fontFamily: "'Lora', Georgia, serif" }}>
            {label} · {art.mimeType}
          </p>
        </div>

        <span className="text-gold-text text-xs shrink-0" style={{ fontFamily: "'Lora', Georgia, serif" }}>
          View
        </span>
      </div>
    </button>
  )
}
