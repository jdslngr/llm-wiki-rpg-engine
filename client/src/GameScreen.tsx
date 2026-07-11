import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ArtAsset, ChapterArtResponse, Dossier, DoneFrame, GameState, Turn, WikiState, WikiUpdate } from './types'
import ArtLoop from './ArtLoop'

const WORD_CAP = 300
const VISIBLE_TURNS = 15

// Phase 6 resilience: abort a turn that takes too long so the spinner can never
// hang forever. Slightly longer than the server's own 75s cap.
const CLIENT_TURN_TIMEOUT_MS = 90_000

function wordCount(s: string): number {
  const t = s.trim()
  return t ? t.split(/\s+/).length : 0
}

type DebugEntry = { from: string; to: string; advanced: boolean; events: string[]; wiki_updates: WikiUpdate[] }

interface Props {
  initialState: GameState
  onLogout: () => void
  onSettings?: () => void
  onChapterComplete?: () => void
  onBackToSaves?: () => void
}

export default function GameScreen({ initialState, onLogout, onSettings, onChapterComplete, onBackToSaves }: Props) {
  // The playthrough's character is fixed once loaded — to switch, return to Your
  // Stories and start/resume a different one (no in-game restart).
  const [character] = useState<Dossier | null>(initialState.character)
  const [anchor, setAnchor] = useState(initialState.anchor)
  // Server-provided, chapter-agnostic header labels.
  const [chapterNumber, setChapterNumber] = useState(initialState.chapterNumber)
  const [chapterTitle, setChapterTitle] = useState(initialState.chapterTitle)
  const [anchorTitle, setAnchorTitle] = useState(initialState.anchorTitle)
  const [history, setHistory] = useState<Turn[]>(initialState.history)
  const [actions, setActions] = useState<string[]>(initialState.actions)
  const [wikiState, setWikiState] = useState<WikiState>(initialState.wikiState)
  const [setting, setSetting] = useState(initialState.setting)
  const [debug, setDebug] = useState<DebugEntry[]>([])

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showDebug, setShowDebug] = useState(import.meta.env.DEV)
  const [isAdmin, setIsAdmin] = useState(false)
  const [pendingInput, setPendingInput] = useState<string | null>(null)
  const [streamingText, setStreamingText] = useState('')
  // The action that just failed, so we can offer a one-click "Try again".
  const [failedInput, setFailedInput] = useState<string | null>(null)
  const [undoBusy, setUndoBusy] = useState(false)
  const [dossierOpen, setDossierOpen] = useState(false)
  const [showAllTurns, setShowAllTurns] = useState(false)
  const [isScrolledUp, setIsScrolledUp] = useState(false)
  const [isScrolledFromTop, setIsScrolledFromTop] = useState(false)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [navMenuOpen, setNavMenuOpen] = useState(false)
  const [chapterArt, setChapterArt] = useState<ArtAsset | null>(null)
  const [beatArtByAnchor, setBeatArtByAnchor] = useState<Record<string, ArtAsset>>({})

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setIsAdmin(!!d?.user?.isAdmin))
      .catch(() => {})
  }, [])

  // Fetch chapter art and beat art for the current chapter.
  useEffect(() => {
    let cancelled = false
    async function loadArt() {
      const params = new URLSearchParams({ playthroughId: initialState.playthroughId })
      try {
        const res = await fetch(`/api/art/${chapterNumber}?${params.toString()}`)
        const data: ChapterArtResponse = await res.json()
        if (cancelled) return
        if (res.ok) {
          setChapterArt(data.chapterArt)
          setBeatArtByAnchor(data.beatArt)
        }
      } catch {
        /* art is best-effort; never block the game on it */
      }
    }
    loadArt()
    return () => { cancelled = true }
  }, [chapterNumber, initialState.playthroughId])

  useEffect(() => {
    if (!navMenuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navMenuOpen])

  const logRef = useRef<HTMLDivElement>(null)
  // Scroll behaviour: jump to the TOP on a fresh load (mount, new game, resume,
  // restart) so the player starts at the opening prose.  After the player sends a
  // response the effect scrolls their message to the top of the viewport — the AI
  // response then streams in below the fold.  `wantTop` is set true by adopt() and
  // on mount; `snapPlayerToTop` is set true in takeTurn before the state updates.
  const wantTop = useRef(true)
  const prevLen = useRef(0)
  // Set by takeTurn just before state updates; the effect reads and clears it so
  // the player's just-sent message scrolls to the top of the viewport once.
  const snapPlayerToTop = useRef(false)

  // Keep the input compact for short actions, then grow it with the player's text.
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const textareaWidthRef = useRef<number | null>(null)
  const textareaFrameRef = useRef<number | null>(null)

  const resizeToFit = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const borderHeight = el.offsetHeight - el.clientHeight
    el.style.height = `${el.scrollHeight + borderHeight}px`
  }, [])

  useLayoutEffect(() => {
    resizeToFit()
  }, [resizeToFit, input])

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    textareaWidthRef.current = el.getBoundingClientRect().width
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width
      if (width === textareaWidthRef.current) return
      textareaWidthRef.current = width
      if (textareaFrameRef.current !== null) cancelAnimationFrame(textareaFrameRef.current)
      textareaFrameRef.current = requestAnimationFrame(() => {
        textareaFrameRef.current = null
        resizeToFit()
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (textareaFrameRef.current !== null) cancelAnimationFrame(textareaFrameRef.current)
    }
  }, [resizeToFit])

  useEffect(() => {
    const el = logRef.current
    if (!el) return
    if (wantTop.current) {
      // Fresh load: start at the opening prose.
      el.scrollTo({ top: 0 })
      wantTop.current = false
    } else if (snapPlayerToTop.current && loading) {
      // Player just sent a response — scroll so their message sits at the top of
      // the viewport.  During streaming we intentionally do nothing: the AI
      // response fills in below the fold and the player scrolls down to read it.
      //
      // Defer with requestAnimationFrame so the DOM layout is settled (the live
      // "pending input" bubble may have just been inserted).  Also safe against
      // React StrictMode double-invocation — we only schedule one rAF and clear
      // the flag immediately so subsequent effect runs skip it.
      snapPlayerToTop.current = false
      requestAnimationFrame(() => {
        const playerMsgs = el.querySelectorAll('[data-role="player"]')
        const lastPlayerMsg = playerMsgs[playerMsgs.length - 1]
        if (!(lastPlayerMsg instanceof HTMLElement)) return
        const before = el.scrollTop
        const scrollTarget = el.scrollTop + lastPlayerMsg.getBoundingClientRect().top - el.getBoundingClientRect().top
        el.scrollTo({ top: scrollTarget, behavior: 'auto' })
        if (import.meta.env.DEV) {
          console.log(
            '[scroll-snap] playerMsg el:', lastPlayerMsg,
            '\n  container top:', el.getBoundingClientRect().top,
            'player top:', lastPlayerMsg.getBoundingClientRect().top,
            '\n  old scrollTop:', before,
            '→ new:', el.scrollTop,
            'target was:', scrollTarget,
          )
        }
      })
    }
    prevLen.current = history.length
  }, [history, loading, streamingText])

  // Dev/admin rollback: restore the wiki to before the last committed turn.
  async function undoLastTurn() {
    setUndoBusy(true)
    setError('')
    try {
      const res = await fetch('/api/rollback', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not undo.')
      setAnchor(data.anchor)
      setHistory(data.history)
      setActions(data.actions ?? [])
      setWikiState(data.wikiState ?? {})
      if (typeof data.setting === 'string') setSetting(data.setting)
      setDebug([])
      prevLen.current = data.history.length // keep auto-scroll aligned after the trim
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not undo.')
    } finally {
      setUndoBusy(false)
    }
  }

  const handleTranscriptScroll = useCallback(() => {
    const el = logRef.current
    if (!el) return
    const scrollable = el.scrollHeight - el.clientHeight
    const NEAR_EDGE = 20
    if (scrollable <= 300) {
      setIsScrolledUp(false)
      setIsScrolledFromTop(false)
      return
    }
    setIsScrolledUp(el.scrollTop <= NEAR_EDGE)
    setIsScrolledFromTop(el.scrollTop >= scrollable - NEAR_EDGE)
  }, [])

  useLayoutEffect(() => {
    handleTranscriptScroll()
  }, [dossierOpen, handleTranscriptScroll, history, loading, showAllTurns, streamingText])

  useEffect(() => {
    const el = logRef.current
    if (!el) return
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', handleTranscriptScroll)
      return () => window.removeEventListener('resize', handleTranscriptScroll)
    }
    const observer = new ResizeObserver(handleTranscriptScroll)
    observer.observe(el)
    return () => observer.disconnect()
  }, [handleTranscriptScroll])

  const words = wordCount(input)
  const overCap = words > WORD_CAP
  const beatArt = beatArtByAnchor[anchor] ?? null

  // Export the whole story so far as a Markdown file the player can keep. Built entirely
  // from the in-browser history — AI turns become prose, the player's own actions become
  // "You:" lines — and downloaded via a temporary blob URL (no server round-trip).
  function exportStory() {
    const name = character?.name ?? 'Your character'
    const lines: string[] = [
      '# Archipelago Lighthouse',
      '',
      `**${name}** · Chapter ${chapterNumber}: ${chapterTitle}`,
      '',
      `_Exported ${new Date().toLocaleString()}_`,
      '',
      '---',
      '',
    ]
    for (const t of history) {
      lines.push(t.role === 'player' ? `**You:** ${t.content}` : t.content)
      lines.push('')
    }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'story'
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `archipelago-lighthouse-${slug}-ch${chapterNumber}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function takeTurn(text: string) {
    const playerInput = text.trim()
    if (!playerInput || loading || wordCount(playerInput) > WORD_CAP) return
    snapPlayerToTop.current = true
    setLoading(true)
    setError('')
    setFailedInput(null)
    setPendingInput(playerInput)
    setStreamingText('')
    setInput('')
    setSuggestionsOpen(false)
    const priorHistory = history

    // Abort a turn that runs past the timeout so the spinner can never hang.
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), CLIENT_TURN_TIMEOUT_MS)

    try {
      const res = await fetch('/api/play-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerInput }),
        signal: controller.signal,
      })
      if (!res.ok) {
        let msg = `Request failed (${res.status})`
        try {
          const j = await res.json()
          if (j?.error) msg = j.error
        } catch {
          /* not JSON */
        }
        throw new Error(msg)
      }
      if (!res.body) throw new Error('No response stream')

      // Read the NDJSON stream line-by-line.
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let narrative = ''
      let done: DoneFrame | null = null

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        buffer += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line) continue
          const msg = JSON.parse(line)
          if (msg.type === 'narrative') {
            narrative = msg.text
            setStreamingText(msg.text)
          } else if (msg.type === 'done') {
            done = msg
            if (typeof msg.narrative === 'string' && msg.narrative) narrative = msg.narrative
          } else if (msg.type === 'error') {
            throw new Error(msg.error || 'The storyteller stumbled.')
          }
        }
      }

      // Commit the completed turn. The server already folded events + advanced the
      // anchor; we just reflect what it returned.
      setHistory([
        ...priorHistory,
        { role: 'player', content: playerInput },
        { role: 'ai', content: narrative },
      ])
      setActions(done?.suggested_actions ?? [])
      if (done) {
        setAnchor(done.anchor)
        if (typeof done.chapterNumber === 'number') setChapterNumber(done.chapterNumber)
        if (typeof done.chapterTitle === 'string') setChapterTitle(done.chapterTitle)
        if (typeof done.anchorTitle === 'string') setAnchorTitle(done.anchorTitle)
        setWikiState(done.wikiState ?? {})
        if (typeof done.setting === 'string') setSetting(done.setting)
        setDebug((d) => [
          ...d,
          {
            from: done!.fromAnchor,
            to: done!.anchor,
            advanced: done!.advanced,
            events: done!.events ?? [],
            wiki_updates: done!.wiki_updates ?? [],
          },
        ])
      }
    } catch (err) {
      // Log the real error; show the player a warm, generic message. A timeout
      // (AbortError) gets its own line so a slow turn reads differently from a
      // hard failure.
      console.error('[play-turn]', err)

      // Resync first: the server may have committed the turn even though our
      // fetch died (network drop mid-stream, parse error). If it did, adopt the
      // server's state instead of offering a "Try again" that would double-commit.
      let committed = false
      try {
        const res = await fetch('/api/state')
        if (res.ok) {
          const fresh: GameState = await res.json()
          // A committed turn appends exactly [player, ai]: check positionally that
          // the entry at index priorHistory.length is OUR player input.
          const at = fresh.history[priorHistory.length]
          if (
            fresh.history.length >= priorHistory.length + 2 &&
            at?.role === 'player' &&
            at?.content === playerInput
          ) {
            committed = true
            setHistory(fresh.history)
            setActions(fresh.actions)
            setAnchor(fresh.anchor)
            setChapterNumber(fresh.chapterNumber)
            setChapterTitle(fresh.chapterTitle)
            setAnchorTitle(fresh.anchorTitle)
            setWikiState(fresh.wikiState)
            setSetting(fresh.setting)
            setError('')
            setFailedInput(null)
          }
        }
      } catch {
        // Resync itself failed — fall through to the normal error path.
      }

      if (!committed) {
        const timedOut = err instanceof DOMException && err.name === 'AbortError'
        setError(
          timedOut
            ? 'The storyteller took too long to respond. Your words are safe — try again.'
            : 'The storyteller stumbled. Your words are safe — try again.',
        )
        setInput(playerInput) // restore the player's text so they can retry
        setFailedInput(playerInput)
      }
    } finally {
      clearTimeout(timeout)
      setLoading(false)
      setPendingInput(null)
      setStreamingText('')
    }
  }

  // ── Shared style helpers ──────────────────────────────────────────────────

  const fontTitle: React.CSSProperties = { fontFamily: "'Cinzel', Georgia, serif", letterSpacing: '0.04em' }
  const fontBody: React.CSSProperties = { fontFamily: "'Lora', Georgia, serif" }

  return (
    <div className="flex h-[100svh] flex-col">
      {/* ── Header / nav bar ─────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between gap-2 px-safe py-3 border-b sm:px-8"
        style={{
          background: 'var(--color-bg-nav)',
          borderColor: 'var(--color-gold-dim)',
          boxShadow: '0 2px 16px rgba(0,0,0,0.28)',
        }}
      >
        <div className="min-w-0">
          <h1 className="text-[15px] font-medium text-text-primary" style={fontTitle}>
            Archipelago Lighthouse
          </h1>
          <p className="mt-1 truncate text-xs italic text-text-muted" style={fontBody}>
            Chapter {chapterNumber} · {chapterTitle}
            <span className="mx-1.5 text-text-dim">·</span>
            <span className="text-text-muted">{anchorTitle}</span>
          </p>
        </div>
        <div className="relative shrink-0">
          <button
            onClick={() => setNavMenuOpen((open) => !open)}
            aria-expanded={navMenuOpen}
            aria-haspopup="true"
            className="relative z-50 text-xs border rounded-sm px-[14px] py-1.5 text-gold-text hover:opacity-80 transition"
            style={{ borderColor: 'var(--color-gold-nav)', fontFamily: "'Lora', Georgia, serif", letterSpacing: '0.02em' }}
          >
            Menu {navMenuOpen ? '▴' : '▾'}
          </button>
          {navMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setNavMenuOpen(false)} />
              <div
                className="absolute right-0 top-full z-50 mt-1 min-w-40 rounded-sm py-1"
                style={{
                  background: 'var(--color-bg-surface)',
                  boxShadow: '0 0 0 1px var(--color-gold-border)',
                }}
              >
                <button
                  onClick={() => { exportStory(); setNavMenuOpen(false) }}
                  title="Download this story so far as a Markdown file"
                  className="min-h-11 w-full flex items-center whitespace-nowrap px-4 text-xs text-gold-text hover:opacity-80 transition"
                  style={{ fontFamily: "'Lora', Georgia, serif", letterSpacing: '0.02em' }}
                >
                  ⤓ Export
                </button>
                {onBackToSaves && (
                  <button
                    onClick={() => { onBackToSaves(); setNavMenuOpen(false) }}
                    className="min-h-11 w-full flex items-center whitespace-nowrap px-4 text-xs text-gold-text hover:opacity-80 transition"
                    style={{ fontFamily: "'Lora', Georgia, serif", letterSpacing: '0.02em' }}
                  >
                    ← Your Stories
                  </button>
                )}
                {(import.meta.env.DEV || isAdmin) && (
                  <button
                    onClick={() => { setShowDebug((visible) => !visible); setNavMenuOpen(false) }}
                    className="min-h-11 w-full flex items-center whitespace-nowrap px-4 text-xs text-gold-text hover:opacity-80 transition"
                    style={{ fontFamily: "'Lora', Georgia, serif", letterSpacing: '0.02em' }}
                  >
                    {showDebug ? 'Hide' : 'Show'} debug
                  </button>
                )}
                {onSettings && (
                  <button
                    onClick={() => { onSettings(); setNavMenuOpen(false) }}
                    className="min-h-11 w-full flex items-center whitespace-nowrap px-4 text-xs text-gold-text hover:opacity-80 transition"
                    style={{ fontFamily: "'Lora', Georgia, serif", letterSpacing: '0.02em' }}
                  >
                    Settings
                  </button>
                )}
                <button
                  onClick={async () => {
                    try { await fetch('/api/auth/logout', { method: 'POST' }) } catch { /* ok */ }
                    onLogout()
                    setNavMenuOpen(false)
                  }}
                  className="min-h-11 w-full flex items-center whitespace-nowrap px-4 text-xs text-gold-text hover:opacity-80 transition"
                  style={{ fontFamily: "'Lora', Georgia, serif", letterSpacing: '0.02em' }}
                >
                  Log out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col gap-4 px-safe py-4 xl:flex-row">
        {/* Desktop left rail — chapter art */}
        {chapterArt && (
          <aside className="hidden xl:flex w-[220px] shrink-0 flex-col gap-2">
            <ArtLoop art={chapterArt} className="w-full rounded-sm object-cover" style={{ aspectRatio: '9/16' }} />
            <p className="text-[11px] text-text-muted text-center leading-tight" style={{ fontFamily: "'Lora', Georgia, serif" }}>
              {chapterArt.label}
            </p>
          </aside>
        )}

        {/* Story column */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={logRef}
            onScroll={handleTranscriptScroll}
            className="story-log min-h-[180px] flex-1 space-y-4 overflow-y-auto overscroll-contain border p-5 sm:min-h-[260px]"
            style={{
              background: 'var(--color-bg-story)',
              borderColor: 'var(--color-gold-dim)',
            }}
          >
            {/* Jump-to-latest — appears only right at the top edge */}
            {isScrolledUp && (
              <div className="sticky top-4 flex justify-center">
                <button
                  onClick={() => {
                    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
                    setIsScrolledUp(false)
                  }}
                  aria-label="Scroll to latest"
                  title="Down to latest"
                  className="w-9 h-9 rounded-sm flex items-center justify-center text-lg font-semibold shadow-lg transition hover:opacity-90"
                  style={{
                    background: 'linear-gradient(180deg, var(--color-gold) 0%, var(--color-gold-dark) 100%)',
                    color: 'oklch(0.17 0.050 150)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,228,110,0.25)',
                  }}
                >
                  ↓
                </button>
              </div>
            )}

            {/* Character dossier — collapsible on mobile; tap chip to expand */}
            {character && (
              dossierOpen ? (
                <div
                  className="p-4 rounded-t-sm border"
                  style={{
                    background: 'var(--color-bg-dossier)',
                    borderColor: 'var(--color-gold-mid)',
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="text-sm italic font-medium" style={{ color: 'oklch(0.80 0.022 78)', ...fontBody }}>
                      You are {character.name}
                    </h2>
                    <span className="shrink-0 text-[11px] uppercase tracking-wide text-text-muted">
                      {character.knowsLabel}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs italic text-text-muted" style={fontBody}>{character.povLabel}</p>
                  <p className="mt-1 text-xs text-text-primary" style={fontBody}>{character.role}</p>
                  <p className="mt-2 text-sm leading-relaxed text-text-primary" style={fontBody}>{character.dossier}</p>
                  {setting && (
                    <>
                      <div className="mt-3 flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-dim">
                        <span className="h-px flex-1" style={{ background: 'var(--color-gold-mid)' }} />
                        Setting
                        <span className="h-px flex-1" style={{ background: 'var(--color-gold-mid)' }} />
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-text-muted" style={fontBody}>{setting}</p>
                    </>
                  )}
                  <button
                    onClick={() => setDossierOpen(false)}
                    className="mt-3 text-xs text-text-muted hover:text-text-primary transition"
                    style={fontBody}
                  >
                    Collapse dossier
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setDossierOpen(true)}
                  className="flex w-full items-center gap-2 px-[22px] py-[11px] rounded-t-sm border"
                  style={{
                    background: 'var(--color-bg-dossier)',
                    borderColor: 'var(--color-gold-mid)',
                  }}
                >
                  <span className="text-sm italic text-text-primary" style={{ ...fontBody, color: 'oklch(0.80 0.022 78)' }}>
                    {character.name} &middot; {character.role}
                  </span>
                  <span className="ml-auto text-[13px] text-gold-text" style={fontBody}>Expand dossier +</span>
                </button>
              )
            )}

            {/* Mobile inline beat art — only on non-xl screens, after dossier */}
            {beatArt && (
              <div className="xl:hidden w-full max-w-[260px] mx-auto">
                <ArtLoop art={beatArt} className="w-full rounded-sm object-cover" style={{ aspectRatio: '9/16' }} />
              </div>
            )}

            {/* Older turns — collapsed when there are more than VISIBLE_TURNS */}
            {(() => {
              const turnCutoff = showAllTurns ? 0 : Math.max(0, history.length - VISIBLE_TURNS)
              const hiddenCount = turnCutoff
              const visibleHistory = history.slice(turnCutoff)
              return (
                <>
                  {hiddenCount > 0 && (
                    <div className="text-center mb-7">
                      <button
                        onClick={() => setShowAllTurns(true)}
                        className="text-[13px] text-gold-text hover:opacity-80 transition"
                        style={{ fontFamily: "'Lora', Georgia, serif", letterSpacing: '0.03em' }}
                      >
                        Show {hiddenCount} older turn{hiddenCount !== 1 ? 's' : ''}
                      </button>
                    </div>
                  )}
                  {visibleHistory.map((t, i) =>
                    t.role === 'ai' ? (
                      <div
                        key={turnCutoff + i}
                        className="whitespace-pre-wrap break-words mb-6"
                        style={{
                          fontSize: '16.5px',
                          lineHeight: '1.88',
                          color: 'var(--color-text-body)',
                          textWrap: 'pretty',
                          fontFamily: "'Lora', Georgia, serif",
                        }}
                      >
                        {t.content}
                      </div>
                    ) : (
                      <div key={turnCutoff + i} className="flex justify-end" data-role="player">
                        <div
                          className="max-w-[80%] px-3 py-3 whitespace-pre-wrap break-words"
                          style={{
                            background: 'oklch(0.218 0.050 150)',
                            border: '1px solid var(--color-gold-dim)',
                            color: 'var(--color-text-body)',
                            fontFamily: "'Lora', Georgia, serif",
                          }}
                        >
                          {t.content}
                        </div>
                      </div>
                    ),
                  )}
                </>
              )
            })()}

            {/* Live turn while streaming */}
            {loading && pendingInput && (
              <div className="flex justify-end" data-role="player">
                <div
                  className="max-w-[80%] px-3 py-3 whitespace-pre-wrap break-words"
                  style={{
                    background: 'oklch(0.218 0.050 150)',
                    border: '1px solid var(--color-gold-dim)',
                    color: 'var(--color-text-body)',
                    fontFamily: "'Lora', Georgia, serif",
                  }}
                >
                  {pendingInput}
                </div>
              </div>
            )}
            {loading && (
              <div
                className="whitespace-pre-wrap break-words mb-6"
                style={{
                  fontSize: '16.5px',
                  lineHeight: '1.88',
                  color: 'var(--color-text-body)',
                  textWrap: 'pretty',
                  fontFamily: "'Lora', Georgia, serif",
                }}
              >
                {streamingText ? (
                  <>
                    {streamingText}
                    <span className="ml-0.5 inline-block animate-pulse">▍</span>
                  </>
                ) : (
                  <span className="animate-pulse text-sm text-text-muted" style={fontBody}>The storyteller is writing…</span>
                )}
              </div>
            )}

            {/* Back-to-top — appears only right at the bottom edge */}
            {isScrolledFromTop && (
              <div className="sticky bottom-4 flex justify-center">
                <button
                  onClick={() => {
                    logRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
                    setIsScrolledFromTop(false)
                  }}
                  aria-label="Scroll to top"
                  title="Back to top"
                  className="w-9 h-9 rounded-sm flex items-center justify-center text-lg font-semibold shadow-lg transition hover:opacity-90"
                  style={{
                    background: 'linear-gradient(180deg, var(--color-gold) 0%, var(--color-gold-dark) 100%)',
                    color: 'oklch(0.17 0.050 150)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,228,110,0.25)',
                  }}
                >
                  ↑
                </button>
              </div>
            )}
          </div>

          {anchor === 'END' ? (
            /* Chapter over: let the player read the closing scene, then move on. */
            <div
              className="mt-4 rounded-sm border p-5 text-center"
              style={{
                borderColor: 'var(--color-gold-dim)',
                background: 'var(--color-bg-card)',
              }}
            >
              <p className="text-base font-medium text-text-primary" style={fontBody}>Chapter complete</p>
              <p className="mt-1 text-sm text-text-muted" style={fontBody}>The vow is made. See how your story unfolded.</p>
              <button
                onClick={() => onChapterComplete?.()}
                className="mt-4 w-full rounded-sm px-5 py-3 text-sm font-semibold transition hover:opacity-90 sm:w-auto sm:px-6"
                style={{
                  background: 'linear-gradient(180deg, var(--color-gold) 0%, var(--color-gold-dark) 100%)',
                  color: 'oklch(0.17 0.050 150)',
                  fontFamily: "'Lora', Georgia, serif",
                  letterSpacing: '0.06em',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,228,110,0.25)',
                }}
              >
                View your recap →
              </button>
            </div>
          ) : (
          <>
          {/* Free-form input — first, to encourage the player to write their own action. */}
          <div className="pb-safe-room">
          <div
            className="mt-[10px] rounded-sm border p-[14px_18px_12px]"
            style={{
              background: 'var(--color-bg-card)',
              borderColor: 'var(--color-gold-dim)',
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) takeTurn(input)
              }}
              placeholder="What do you do? Write your own action… (⌘/Ctrl + Enter to send)"
              ref={textareaRef}
              rows={1}
              disabled={loading}
              className="w-full max-h-[200px] resize-none overflow-y-auto border-none bg-transparent text-text-body placeholder:text-text-dim/70 disabled:opacity-60"
              style={{
                fontSize: '16px',
                lineHeight: '1.65',
                fontFamily: "'Lora', Georgia, serif",
              }}
            />

            {/* Suggested actions — toggle expands between textarea and footer */}
            {suggestionsOpen && actions.length > 0 && (
              <>
                <p className="mt-3 text-xs text-text-muted" style={fontBody}>Or try a suggestion:</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {actions.map((a, i) => (
                    <button
                      key={i}
                      disabled={loading}
                      onClick={() => takeTurn(a)}
                      className="rounded-sm border px-4 py-2.5 text-sm text-text-body transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                      style={{
                        background: 'var(--color-bg-input)',
                        borderColor: 'var(--color-gold-mid)',
                        fontFamily: "'Lora', Georgia, serif",
                      }}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div
              className="mt-2 pt-2 flex items-center justify-between"
              style={{ borderTop: '1px solid oklch(0.30 0.050 76 / 0.5)' }}
            >
              <span
                className={`text-xs italic ${overCap ? 'text-red-400' : ''}`}
                style={{ color: overCap ? undefined : 'var(--color-text-dim)', fontFamily: "'Lora', Georgia, serif" }}
              >
                {words}/{WORD_CAP} words
              </span>
              <div className="flex items-center gap-2">
                {actions.length > 0 && (
                  <button
                    onClick={() => setSuggestionsOpen((open) => !open)}
                    disabled={loading}
                    className="rounded-sm border px-4 py-2.5 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      background: 'var(--color-bg-input)',
                      borderColor: 'var(--color-gold-mid)',
                      color: 'var(--color-text-muted)',
                      fontFamily: "'Lora', Georgia, serif",
                    }}
                  >
                    {suggestionsOpen ? 'Hide suggestions' : 'Suggestions'}
                  </button>
                )}
                <button
                  onClick={() => takeTurn(input)}
                  disabled={loading || !input.trim() || overCap}
                  aria-label={loading ? 'Sending action' : 'Send action'}
                  title="Send (⌘/Ctrl + Enter)"
                  className={`flex items-center justify-center rounded-sm p-[11px] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${loading ? 'animate-pulse' : ''}`}
                  style={{
                    background: 'linear-gradient(180deg, var(--color-gold) 0%, var(--color-gold-dark) 100%)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,228,110,0.25)',
                  }}
                >
                  <span aria-hidden="true" style={{ fontSize: '22px', lineHeight: 1 }}>✒️</span>
                </button>
              </div>
            </div>
            {error && (
              <div className="mt-2 flex items-center gap-3 text-sm text-red-400">
                <span>{error}</span>
                {failedInput && (
                  <button
                    onClick={() => takeTurn(failedInput)}
                    disabled={loading}
                    className="border border-red-400/40 px-2 py-0.5 text-red-200 transition hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-50 rounded-sm"
                  >
                    Try again
                  </button>
                )}
              </div>
            )}
          </div>
          </div>


          </>
          )}
        </main>

        {/* Desktop right rail — beat art (hidden when debug is open) */}
        {beatArt && (!showDebug || !(import.meta.env.DEV || isAdmin)) && (
          <aside className="hidden xl:flex w-[260px] shrink-0 flex-col gap-2">
            <ArtLoop art={beatArt} className="w-full rounded-sm object-cover" style={{ aspectRatio: '9/16' }} />
            <p className="text-[11px] text-text-muted text-center leading-tight" style={{ fontFamily: "'Lora', Georgia, serif" }}>
              {beatArt.label}
            </p>
          </aside>
        )}

        {/* Debug panel — dev or admin (takes priority over beat art rail) */}
        {(import.meta.env.DEV || isAdmin) && showDebug && (
          <aside
            className="w-full overflow-y-auto border p-4 text-xs md:w-80 md:shrink-0"
            style={{
              borderColor: 'var(--color-gold-dim)',
              background: 'var(--color-bg-card)',
              maxHeight: 'min(40svh, 420px)',
              fontFamily: "'Lora', Georgia, serif",
            }}
          >
            <h2 className="mb-2 font-semibold text-text-primary">Debug — server-owned state</h2>

            <button
              onClick={undoLastTurn}
              disabled={undoBusy || loading}
              className="mb-3 w-full border rounded-sm px-3 py-2.5 text-gold-text hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 transition"
              style={{ borderColor: 'var(--color-gold-nav)' }}
            >
              {undoBusy ? 'Undoing…' : '⟲ Undo last turn (rollback)'}
            </button>

            <div className="mb-4">
              <div className="mb-1 text-text-muted">Live wiki state (anchor: {anchor})</div>
              <pre className="overflow-x-auto p-2 text-[11px] text-emerald-300" style={{ background: 'var(--color-bg-input)' }}>
                {JSON.stringify(wikiState, null, 1)}
              </pre>
            </div>

            <div className="text-text-muted">Per-turn events / advancement</div>
            {debug.length === 0 && <div className="mt-1 text-text-dim">No turns yet.</div>}
            {debug
              .map((d, i) => (
                <div
                  key={i}
                  className="mt-2 border rounded-sm p-2"
                  style={{ borderColor: 'var(--color-gold-mid)' }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-text-muted">Turn {i + 1}</span>
                    {d.advanced && (
                      <span className="text-emerald-400">
                        {d.from} → {d.to}
                      </span>
                    )}
                  </div>
                  <div className="mt-1">
                    <span className="text-text-muted">events:</span>{' '}
                    <span className="text-sky-300">{JSON.stringify(d.events)}</span>
                  </div>
                  {d.wiki_updates.length > 0 && (
                    <div className="mt-1">
                      <span className="text-text-muted">wiki_updates:</span>
                      <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap text-amber-300">
                        {JSON.stringify(d.wiki_updates, null, 1)}
                      </pre>
                    </div>
                  )}
                </div>
              ))
              .reverse()}
          </aside>
        )}
      </div>
    </div>
  )
}
