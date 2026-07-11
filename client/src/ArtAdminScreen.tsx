import { useEffect, useRef, useState } from 'react'
import type { ArtAsset, ArtChapterOption, ChapterArtResponse } from './types'

interface Props {
  onBack: () => void
}

const ALLOWED_MIMES = [
  'video/mp4',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
] as const

const ALLOWED_EXTENSIONS = '.mp4,.jpg,.jpeg,.png,.webp,.gif,.avif'

const SERVER_MAX_MB = 50
const WARN_MB = 25

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Shared UI tokens (match AuthoringScreen) ──────────────────────────────────

const fontTitle: React.CSSProperties = { fontFamily: "'Cinzel', Georgia, serif", letterSpacing: '0.04em' }
const fontBody: React.CSSProperties = { fontFamily: "'Lora', Georgia, serif" }
const fontLabel: React.CSSProperties = { fontFamily: "'Lora', Georgia, serif" }

const inputCls = 'w-full rounded-sm border p-[10px_14px] text-sm text-text-primary'
const inputStyle: React.CSSProperties = {
  background: 'var(--color-bg-input)',
  borderColor: 'var(--color-gold-mid)',
  fontFamily: "'Lora', Georgia, serif",
}
const selectCls = inputCls
const selectStyle = inputStyle
const labelCls = 'block text-[11px] uppercase tracking-[0.12em] text-text-muted mb-2'

const ghostBtn = 'border rounded-sm px-3 py-2 text-xs transition hover:opacity-80 disabled:opacity-50'
const ghostBtnStyle: React.CSSProperties = {
  borderColor: 'var(--color-gold-mid)',
  color: 'var(--color-gold-text)',
  fontFamily: "'Lora', Georgia, serif",
}

const goldBtn = 'rounded-sm text-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
const goldBtnStyle: React.CSSProperties = {
  background: 'linear-gradient(180deg, var(--color-gold) 0%, var(--color-gold-dark) 100%)',
  color: 'oklch(0.17 0.050 150)',
  fontFamily: "'Lora', Georgia, serif",
  letterSpacing: '0.06em',
  boxShadow: '0 2px 8px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,228,110,0.25)',
}

const dangerBtn = 'border rounded-sm px-3 py-2 text-xs transition hover:opacity-80 disabled:opacity-50'
const dangerBtnStyle: React.CSSProperties = {
  borderColor: 'oklch(0.55 0.12 25 / 0.4)',
  color: '#fca5a5',
  fontFamily: "'Lora', Georgia, serif",
}

export default function ArtAdminScreen({ onBack }: Props) {
  const [chapters, setChapters] = useState<ArtChapterOption[]>([])
  const [chapterNumber, setChapterNumber] = useState<number>(1)
  const [anchor, setAnchor] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const [existing, setExisting] = useState<ChapterArtResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Load chapter list ──────────────────────────────────────────────────────

  async function loadChapters() {
    try {
      const res = await fetch('/api/admin/art/chapters')
      if (!res.ok) return
      const data = await res.json()
      const list: ArtChapterOption[] = data.chapters ?? []
      setChapters(list)
      if (list.length > 0) setChapterNumber(list[0].number)
    } catch {
      /* non-fatal */
    }
  }
  useEffect(() => {
    loadChapters()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Load existing art for the selected chapter ─────────────────────────────

  async function loadExistingArt(chNum: number) {
    setExisting(null)
    try {
      const res = await fetch(`/api/admin/art/${chNum}`)
      if (!res.ok) return
      setExisting(await res.json())
    } catch {
      /* non-fatal */
    }
  }
  useEffect(() => {
    setError('')
    setOkMsg('')
    loadExistingArt(chapterNumber)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterNumber])

  // ── Revoke preview URLs on cleanup ─────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── File change handler ────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError('')
    setOkMsg('')
    const f = e.target.files?.[0] ?? null

    // Revoke old preview
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }

    if (!f) {
      setFile(null)
      return
    }

    // Client MIME check — server is authoritative
    if (!ALLOWED_MIMES.includes(f.type as typeof ALLOWED_MIMES[number])) {
      setError(`"${f.type || 'unknown'}" is not a supported art format. Use MP4, JPEG, PNG, WebP, GIF, or AVIF.`)
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    // Hard cap at 50 MB
    if (f.size > SERVER_MAX_MB * 1024 * 1024) {
      setError(`File is ${formatSize(f.size)} — the server limit is ${SERVER_MAX_MB} MB. Please pick a smaller file.`)
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setFile(f)
    setPreviewUrl(URL.createObjectURL(f))
  }

  function clearFileSelection() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Upload ─────────────────────────────────────────────────────────────────

  async function upload() {
    if (!file) return
    setBusy(true)
    setError('')
    setOkMsg('')

    try {
      const form = new FormData()
      form.append('file', file)
      form.append('chapterNumber', String(chapterNumber))
      if (anchor) form.append('anchor', anchor)

      const res = await fetch('/api/admin/art/upload', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Upload failed.')

      setOkMsg(`Uploaded: "${data.art?.label ?? 'art'}"`)
      clearFileSelection()
      await loadExistingArt(chapterNumber)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async function deleteArt(art: ArtAsset) {
    if (!confirm(`Delete "${art.label}"? This cannot be undone.`)) return
    setDeletingId(art.id)
    setError('')
    setOkMsg('')
    try {
      const res = await fetch(`/api/admin/art/${encodeURIComponent(art.id)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Delete failed.')
      setOkMsg(`Deleted: "${art.label}"`)
      await loadExistingArt(chapterNumber)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setDeletingId(null)
    }
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const selectedChapter = chapters.find((c) => c.number === chapterNumber)
  const anchors = selectedChapter?.anchors ?? []
  const fileSizeWarning = file && file.size > WARN_MB * 1024 * 1024

  const beatAssets = existing
    ? Object.entries(existing.beatArt).map(([anchorId, art]) => ({ anchorId, art }))
    : []

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-[100svh]">
      {/* Header bar — matches AuthoringScreen */}
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
          <h1 className="text-[15px] font-medium text-text-primary" style={fontTitle}>Manage Art</h1>
          <p className="text-xs italic text-text-muted mt-1" style={fontBody}>
            Upload chapter and beat art. MP4, JPEG, PNG, WebP, GIF, or AVIF — up to {SERVER_MAX_MB} MB.
          </p>
        </div>
        <button onClick={onBack} className={ghostBtn} style={ghostBtnStyle}>
          ← Your Stories
        </button>
      </header>

      <div className="mx-auto w-full max-w-[860px] px-5 py-5">
        {/* Messages */}
        {error && (
          <div className="mb-4 border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-400 rounded-sm">{error}</div>
        )}
        {okMsg && (
          <div className="mb-4 border rounded-sm p-3 text-sm text-text-primary" style={{ borderColor: 'var(--color-gold-mid)', background: 'oklch(0.35 0.070 76 / 0.15)' }}>{okMsg}</div>
        )}

        {/* ── Upload form ─────────────────────────────────────────────────── */}
        <div
          className="rounded-sm border p-[24px_28px] mb-6"
          style={{
            background: 'var(--color-bg-card)',
            borderColor: 'var(--color-gold-mid)',
          }}
        >
          <h2 className="text-sm font-semibold text-text-primary mb-4" style={fontTitle}>
            Upload Art
          </h2>

          {/* Chapter picker */}
          <div className="mb-4">
            <label className={labelCls} style={fontLabel}>Chapter</label>
            <select
              value={chapterNumber}
              onChange={(e) => setChapterNumber(Number(e.target.value))}
              className={selectCls}
              style={selectStyle}
            >
              {chapters.map((c) => (
                <option key={c.number} value={c.number}>
                  Chapter {c.number} — {c.title}
                </option>
              ))}
            </select>
          </div>

          {/* Beat anchor picker */}
          <div className="mb-4">
            <label className={labelCls} style={fontLabel}>
              Beat anchor <span className="normal-case tracking-normal text-text-dim">(blank = chapter art)</span>
            </label>
            <select
              value={anchor}
              onChange={(e) => setAnchor(e.target.value)}
              className={selectCls}
              style={selectStyle}
            >
              <option value="">Chapter art (no beat)</option>
              {anchors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} — {a.title}
                </option>
              ))}
            </select>
          </div>

          {/* File picker */}
          <div className="mb-4">
            <label className={labelCls} style={fontLabel}>File</label>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_EXTENSIONS}
              onChange={handleFileChange}
              className={inputCls}
              style={{ ...inputStyle, padding: '8px 10px' }}
            />
            {file && (
              <p className="mt-1 text-xs text-text-muted" style={fontBody}>
                {file.name} · {formatSize(file.size)}
                {fileSizeWarning && (
                  <span className="text-amber-400 ml-1">(over 25 MB — may be slow to upload)</span>
                )}
              </p>
            )}
          </div>

          {/* Local preview */}
          {file && previewUrl && (
            <div className="mb-4">
              <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted mb-2" style={fontLabel}>Preview</p>
              <div className="w-[180px]">
                {file.type.startsWith('image/') ? (
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="w-full rounded-sm object-cover"
                    style={{ aspectRatio: '9/16' }}
                  />
                ) : (
                  <video
                    src={previewUrl}
                    controls
                    muted
                    className="w-full rounded-sm"
                    style={{ aspectRatio: '9/16' }}
                  />
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={upload}
              disabled={busy || !file}
              className={`${goldBtn} font-semibold px-[28px] py-3`}
              style={goldBtnStyle}
            >
              {busy ? 'Uploading…' : 'Upload'}
            </button>
            {file && (
              <button onClick={clearFileSelection} className={ghostBtn} style={ghostBtnStyle}>
                Clear
              </button>
            )}
          </div>
        </div>

        {/* ── Existing art ────────────────────────────────────────────────── */}
        <div
          className="rounded-sm border p-[24px_28px]"
          style={{
            background: 'var(--color-bg-card)',
            borderColor: 'var(--color-gold-mid)',
          }}
        >
          <h2 className="text-sm font-semibold text-text-primary mb-4" style={fontTitle}>
            Existing Art — Chapter {chapterNumber}
          </h2>

          {!existing ? (
            <p className="text-xs text-text-dim" style={fontBody}>Loading…</p>
          ) : (!existing.chapterArt && beatAssets.length === 0) ? (
            <p className="text-xs text-text-dim" style={fontBody}>No art uploaded for this chapter yet.</p>
          ) : (
            <div className="space-y-3">
              {/* Chapter art row */}
              {existing.chapterArt && (
                <ArtRow
                  art={existing.chapterArt}
                  label="Chapter art"
                  onDelete={() => deleteArt(existing.chapterArt!)}
                  deleting={deletingId === existing.chapterArt.id}
                />
              )}

              {/* Beat art rows */}
              {beatAssets.map(({ anchorId, art }) => (
                <ArtRow
                  key={anchorId}
                  art={art}
                  label={`Beat: ${anchorId}`}
                  onDelete={() => deleteArt(art)}
                  deleting={deletingId === art.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Shared art row (preview + label + delete) ─────────────────────────────────

function ArtRow({
  art,
  label,
  onDelete,
  deleting,
}: {
  art: ArtAsset
  label: string
  onDelete: () => void
  deleting: boolean
}) {
  return (
    <div
      className="flex items-center gap-4 rounded-sm border p-3"
      style={{
        background: 'oklch(0.22 0.035 150)',
        borderColor: 'var(--color-gold-mid)',
      }}
    >
      {/* Thumbnail */}
      <div className="w-16 shrink-0 rounded-sm overflow-hidden" style={{ aspectRatio: '9/16' }}>
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
            className="w-full h-full object-cover"
          />
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text-primary truncate" style={{ fontFamily: "'Lora', Georgia, serif" }}>
          {art.label}
        </p>
        <p className="text-xs text-text-muted" style={{ fontFamily: "'Lora', Georgia, serif" }}>
          {label} · {art.mimeType} · {formatSize(art.sizeBytes)}
        </p>
      </div>

      {/* Delete */}
      <button
        onClick={onDelete}
        disabled={deleting}
        className={dangerBtn}
        style={dangerBtnStyle}
      >
        {deleting ? 'Deleting…' : 'Delete'}
      </button>
    </div>
  )
}
