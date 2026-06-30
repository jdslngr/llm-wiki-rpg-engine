import { useEffect, useState } from 'react'
import type { AuthoredChapterRow, ChapterBrief, ChapterSpec, Clause, EndStateOp } from './types'

interface Props {
  onBack: () => void
}

type Stage = 'brief' | 'review'
type Beat = { title: string; whatHappens: string; conditionPlain: string }

const blankBeat = (): Beat => ({ title: '', whatHappens: '', conditionPlain: '' })

function clauseToPlain(c: Clause): string {
  return c.op === 'count_gte' ? `${c.field} reaches at least ${c.value ?? 1}` : `${c.field} is true`
}

// Reverse-map a spec's anchors back into brief-shaped beats, so "Re-expand with notes"
// after Edit has real content to revise instead of the blank brief fields.
function beatsFromSpec(spec: ChapterSpec): Beat[] {
  return spec.anchors.map((a) => ({
    title: a.title,
    whatHappens: a.note,
    conditionPlain: a.advanceWhen.map(clauseToPlain).join(' and '),
  }))
}

const inputCls =
  'w-full rounded-sm border p-[10px_14px] text-sm text-text-primary'
const inputStyle: React.CSSProperties = {
  background: 'var(--color-bg-input)',
  borderColor: 'var(--color-gold-mid)',
  fontFamily: "'Lora', Georgia, serif",
}
const labelCls = 'block text-[11px] uppercase tracking-[0.12em] text-text-muted mb-2'

const fontTitle: React.CSSProperties = { fontFamily: "'Cinzel', Georgia, serif", letterSpacing: '0.04em' }
const fontBody: React.CSSProperties = { fontFamily: "'Lora', Georgia, serif" }
const fontLabel: React.CSSProperties = { fontFamily: "'Lora', Georgia, serif" }

const goldBtn = 'rounded-sm text-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
const goldBtnStyle: React.CSSProperties = {
  background: 'linear-gradient(180deg, var(--color-gold) 0%, var(--color-gold-dark) 100%)',
  color: 'oklch(0.17 0.050 150)',
  fontFamily: "'Lora', Georgia, serif",
  letterSpacing: '0.06em',
  boxShadow: '0 2px 8px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,228,110,0.25)',
}

const ghostBtn = 'border rounded-sm px-3 py-2 text-xs transition hover:opacity-80 disabled:opacity-50'
const ghostBtnStyle: React.CSSProperties = {
  borderColor: 'var(--color-gold-mid)',
  color: 'var(--color-gold-text)',
  fontFamily: "'Lora', Georgia, serif",
}

const primaryBtnCls = `${goldBtn} font-semibold`

export default function AuthoringScreen({ onBack }: Props) {
  const [stage, setStage] = useState<Stage>('brief')

  // Brief (stage 1).
  const [number, setNumber] = useState(2)
  const [title, setTitle] = useState('')
  const [beats, setBeats] = useState<Beat[]>([blankBeat()])
  const [guardrails, setGuardrails] = useState('')
  const [openingHint, setOpeningHint] = useState('')
  const [notes, setNotes] = useState('')

  // Draft (stage 2).
  const [spec, setSpec] = useState<ChapterSpec | null>(null)
  const [problems, setProblems] = useState<string[]>([])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [savedMsg, setSavedMsg] = useState('')

  // Existing authored chapters.
  const [list, setList] = useState<AuthoredChapterRow[]>([])

  async function loadList() {
    try {
      const res = await fetch('/api/admin/chapters')
      if (!res.ok) return
      const data = await res.json()
      setList(data.chapters ?? [])
      // Default the next chapter number to one past the highest known (min 2).
      const maxNum = Math.max(1, ...((data.chapters ?? []) as AuthoredChapterRow[]).map((c) => c.number))
      if (stage === 'brief' && !spec) setNumber(maxNum + 1)
    } catch {
      /* non-fatal */
    }
  }
  useEffect(() => {
    loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Stage 1: expand the brief with AI ──────────────────────────────────────
  async function expand() {
    if (number === 1) {
      setError('Chapter 1 is built-in — pick a different number (the tool authors Chapter 2 onward).')
      return
    }
    setBusy(true)
    setError('')
    setSavedMsg('')
    const brief: ChapterBrief = {
      number,
      title: title.trim(),
      beats: beats
        .filter((b) => b.title.trim() || b.whatHappens.trim() || b.conditionPlain.trim())
        .map((b) => ({
          title: b.title.trim(),
          whatHappens: b.whatHappens.trim(),
          conditionPlain: b.conditionPlain.trim(),
        })),
      guardrails: guardrails.trim() || undefined,
      openingHint: openingHint.trim() || undefined,
      notes: notes.trim() || undefined,
    }
    try {
      const res = await fetch('/api/admin/expand-chapter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'The AI could not expand this brief.')
      setSpec({ ...data.spec, number }) // keep the author's chosen number
      setProblems(data.problems ?? [])
      setStage('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not expand the brief.')
    } finally {
      setBusy(false)
    }
  }

  // ── Stage 2: save the chapter (goes live immediately) ──────────────────────
  async function save() {
    if (!spec) return
    setBusy(true)
    setError('')
    setProblems([])
    try {
      const res = await fetch('/api/admin/save-chapter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (Array.isArray(data.problems)) setProblems(data.problems)
        throw new Error(data.error ?? 'Could not save the chapter.')
      }
      setSavedMsg(`Chapter ${data.number} — “${data.title}” — is live.`)
      await loadList()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the chapter.')
    } finally {
      setBusy(false)
    }
  }

  async function editChapter(n: number) {
    setError('')
    try {
      const res = await fetch(`/api/admin/chapters/${n}`)
      if (!res.ok) throw new Error('Could not load that chapter.')
      const row = (await res.json()) as AuthoredChapterRow
      setSpec(row.spec)
      setNumber(row.number)
      // Repopulate the brief fields from the loaded spec, so "Re-expand with notes" has
      // real content to revise instead of whatever was left over from a previous draft.
      setTitle(row.spec.title)
      setBeats(beatsFromSpec(row.spec))
      setGuardrails('')
      setOpeningHint('')
      setNotes('')
      setProblems([])
      setSavedMsg('')
      setStage('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load that chapter.')
    }
  }

  async function deleteChapter(n: number) {
    if (!confirm(`Delete Chapter ${n}? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/admin/chapters/${n}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? 'Could not delete.')
      }
      await loadList()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the chapter.')
    }
  }

  function startNew() {
    setSpec(null)
    setProblems([])
    setSavedMsg('')
    setError('')
    setTitle('')
    setBeats([blankBeat()])
    setGuardrails('')
    setOpeningHint('')
    setNotes('')
    setStage('brief')
    loadList()
  }

  // Immutable spec helpers (review stage).
  const patchSpec = (p: Partial<ChapterSpec>) => setSpec((s) => (s ? { ...s, ...p } : s))
  const anchorIds = spec?.anchors.map((a) => a.id) ?? []

  // Cross-chapter endState hints from already-saved chapters.
  const endStateHints: Record<string, { op: string; chapterNumber: number }> = {}
  for (const row of list) {
    if (row.number === spec?.number) continue
    for (const op of row.spec.endState ?? []) {
      endStateHints[op.field] = { op: op.op, chapterNumber: row.number }
    }
  }

  return (
    <div className="min-h-screen">
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
          <h1 className="text-[15px] font-medium text-text-primary" style={fontTitle}>Chapter Authoring</h1>
          <p className="text-xs italic text-text-muted mt-1" style={fontBody}>
            {stage === 'brief' ? 'Sketch the beats — the AI expands them into a chapter.' : 'Review, edit, and save. Saving goes live instantly.'}
          </p>
        </div>
        <button
          onClick={onBack}
          className={ghostBtn}
          style={ghostBtnStyle}
        >
          ← Your Stories
        </button>
      </header>

      <div className="mx-auto w-full max-w-[860px] px-5 py-5">
        {error && <div className="mb-4 border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-400 rounded-sm">{error}</div>}
        {savedMsg && <div className="mb-4 border rounded-sm p-3 text-sm text-text-primary" style={{ borderColor: 'var(--color-gold-mid)', background: 'oklch(0.35 0.070 76 / 0.15)' }}>{savedMsg}</div>}
        {problems.length > 0 && (
          <div className="mb-4 border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-400 rounded-sm">
            <p className="mb-1 font-semibold">Fix these before saving:</p>
            <ul className="list-disc pl-5">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </div>
        )}

        {/* ── STAGE 1: BRIEF ─────────────────────────────────────────────── */}
        {stage === 'brief' && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="w-24">
                <label className={labelCls} style={fontLabel}>Number</label>
                <input type="number" min={2} value={number} onChange={(e) => setNumber(Number(e.target.value))} className={inputCls} style={inputStyle} />
              </div>
              <div className="flex-1">
                <label className={labelCls} style={fontLabel}>Chapter title</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The Abandoned Facility" className={inputCls} style={inputStyle} />
              </div>
            </div>

            <div>
              <label className={labelCls} style={fontLabel}>Beats (in order)</label>
              <div className="space-y-3">
                {beats.map((b, i) => (
                  <div
                    key={i}
                    className="rounded-sm border p-[16px_18px]"
                    style={{
                      background: 'var(--color-bg-card)',
                      borderColor: 'var(--color-gold-mid)',
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[13px] italic text-text-muted" style={fontBody}>Beat {i + 1}</span>
                      {beats.length > 1 && (
                        <button onClick={() => setBeats(beats.filter((_, j) => j !== i))} className="text-xs text-red-300 hover:text-red-200">Remove</button>
                      )}
                    </div>
                    <input
                      value={b.title}
                      onChange={(e) => setBeats(beats.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                      placeholder="Beat title (e.g. Approach)"
                      className={`${inputCls} mb-2`}
                      style={inputStyle}
                    />
                    <textarea
                      value={b.whatHappens}
                      onChange={(e) => setBeats(beats.map((x, j) => (j === i ? { ...x, whatHappens: e.target.value } : x)))}
                      placeholder="What happens in this beat?"
                      rows={2}
                      className={`${inputCls} mb-2`}
                      style={inputStyle}
                    />
                    <input
                      value={b.conditionPlain}
                      onChange={(e) => setBeats(beats.map((x, j) => (j === i ? { ...x, conditionPlain: e.target.value } : x)))}
                      placeholder="Advances when… (e.g. they explore 2 rooms and find a clue)"
                      className={inputCls}
                      style={inputStyle}
                    />
                  </div>
                ))}
              </div>
              <button
                onClick={() => setBeats([...beats, blankBeat()])}
                className={`${ghostBtn} mt-2 text-[13px]`}
                style={ghostBtnStyle}
              >
                + Add beat
              </button>
            </div>

            <div>
              <label className={labelCls} style={fontLabel}>Guardrails (optional)</label>
              <textarea value={guardrails} onChange={(e) => setGuardrails(e.target.value)} placeholder="What must NOT happen yet (e.g. don't reveal the artifact)" rows={2} className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls} style={fontLabel}>Opening direction (optional)</label>
              <textarea value={openingHint} onChange={(e) => setOpeningHint(e.target.value)} placeholder="A hint for the chapter's opening scene" rows={2} className={inputCls} style={inputStyle} />
            </div>

            <button
              onClick={expand}
              disabled={busy || !title.trim() || beats.every((b) => !b.title.trim())}
              className={`${primaryBtnCls} px-[28px] py-3`}
              style={goldBtnStyle}
            >
              {busy ? 'Expanding with AI…' : 'Expand with AI →'}
            </button>
          </div>
        )}

        {/* ── STAGE 2: REVIEW & SAVE ─────────────────────────────────────── */}
        {stage === 'review' && spec && (
          <div className="space-y-5">
            <div className="flex gap-3">
              <div className="w-24">
                <label className={labelCls} style={fontLabel}>Number</label>
                <input type="number" value={spec.number} onChange={(e) => patchSpec({ number: Number(e.target.value) })} className={inputCls} style={inputStyle} />
              </div>
              <div className="flex-1">
                <label className={labelCls} style={fontLabel}>Title</label>
                <input value={spec.title} onChange={(e) => patchSpec({ title: e.target.value })} className={inputCls} style={inputStyle} />
              </div>
              <div className="w-32">
                <label className={labelCls} style={fontLabel}>Stall turns</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={spec.softLockThreshold ?? 5}
                  onChange={(e) => patchSpec({ softLockThreshold: Number(e.target.value) || undefined })}
                  className={inputCls}
                  style={inputStyle}
                  title="Turns without progress before the engine nudges the player"
                />
              </div>
            </div>

            <div>
              <label className={labelCls} style={fontLabel}>Fragment (chapter overview + guardrails)</label>
              <textarea value={spec.fragment} onChange={(e) => patchSpec({ fragment: e.target.value })} rows={5} className={inputCls} style={inputStyle} />
            </div>

            {/* Anchors */}
            <div>
              <label className={labelCls} style={fontLabel}>Beats &amp; conditions</label>
              <div className="space-y-3">
                {spec.anchors.map((a, ai) => {
                  const setAnchor = (patch: Partial<typeof a>) =>
                    patchSpec({ anchors: spec.anchors.map((x, j) => (j === ai ? { ...x, ...patch } : x)) })
                  const setClause = (ci: number, patch: Partial<Clause>) =>
                    setAnchor({ advanceWhen: a.advanceWhen.map((c, j) => (j === ci ? { ...c, ...patch } : c)) })
                  return (
                    <div
                      key={ai}
                      className="rounded-sm border p-[16px_18px]"
                      style={{
                        background: 'var(--color-bg-card)',
                        borderColor: 'var(--color-gold-mid)',
                      }}
                    >
                      <div className="mb-2 flex gap-2">
                        <input value={a.id} onChange={(e) => setAnchor({ id: e.target.value })} className={`${inputCls} w-20`} style={inputStyle} />
                        <input value={a.title} onChange={(e) => setAnchor({ title: e.target.value })} placeholder="Beat title" className={inputCls} style={inputStyle} />
                      </div>
                      <textarea value={a.note} onChange={(e) => setAnchor({ note: e.target.value })} placeholder="Director's note" rows={2} className={`${inputCls} mb-2`} style={inputStyle} />
                      <p className="mb-1 text-xs text-text-dim" style={fontBody}>Advances when ALL of:</p>
                      {a.advanceWhen.map((c, ci) => (
                        <div key={ci} className="mb-1 flex flex-wrap items-center gap-2">
                          <input value={c.field} onChange={(e) => setClause(ci, { field: e.target.value })} placeholder="field" className={`${inputCls} w-40`} style={inputStyle} />
                          <select value={c.op} onChange={(e) => setClause(ci, { op: e.target.value as Clause['op'] })} className={`${inputCls} w-32`} style={inputStyle}>
                            <option value="flag">is true</option>
                            <option value="count_gte">count ≥</option>
                          </select>
                          {c.op === 'count_gte' && (
                            <input type="number" value={c.value ?? 1} onChange={(e) => setClause(ci, { value: Number(e.target.value) })} className={`${inputCls} w-16`} style={inputStyle} />
                          )}
                          <input value={c.hint ?? ''} onChange={(e) => setClause(ci, { hint: e.target.value })} placeholder="hint" className={`${inputCls} flex-1`} style={inputStyle} />
                          <button onClick={() => setAnchor({ advanceWhen: a.advanceWhen.filter((_, j) => j !== ci) })} className="text-xs text-red-300">✕</button>
                        </div>
                      ))}
                      <button onClick={() => setAnchor({ advanceWhen: [...a.advanceWhen, { field: '', op: 'flag' }] })} className={`${ghostBtn} mt-1`} style={ghostBtnStyle}>+ condition</button>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Events */}
            <div>
              <label className={labelCls} style={fontLabel}>Events (what the narrator may report → which field it sets)</label>
              <div className="space-y-1">
                {spec.events.map((ev, ei) => {
                  const setEvent = (patch: Partial<typeof ev>) =>
                    patchSpec({ events: spec.events.map((x, j) => (j === ei ? { ...x, ...patch } : x)) })
                  return (
                    <div key={ei} className="flex flex-wrap items-center gap-2">
                      <input value={ev.token} onChange={(e) => setEvent({ token: e.target.value })} placeholder="event_token" className={`${inputCls} w-44`} style={inputStyle} />
                      <select value={ev.anchor} onChange={(e) => setEvent({ anchor: e.target.value })} className={`${inputCls} w-20`} style={inputStyle}>
                        {anchorIds.map((id) => <option key={id} value={id}>{id}</option>)}
                      </select>
                      <span className="text-xs text-text-dim">→</span>
                      <input value={ev.fold.field} onChange={(e) => setEvent({ fold: { ...ev.fold, field: e.target.value } })} placeholder="field" className={`${inputCls} w-40`} style={inputStyle} />
                      <input value={ev.fold.token ?? ''} onChange={(e) => setEvent({ fold: { ...ev.fold, token: e.target.value || undefined } })} placeholder="array item (optional)" className={`${inputCls} w-36`} style={inputStyle} />
                      <button onClick={() => patchSpec({ events: spec.events.filter((_, j) => j !== ei) })} className="text-xs text-red-300">✕</button>
                    </div>
                  )
                })}
              </div>
              <button onClick={() => patchSpec({ events: [...spec.events, { token: '', anchor: anchorIds[0] ?? '', fold: { field: '' } }] })} className={`${ghostBtn} mt-2`} style={ghostBtnStyle}>+ event</button>
            </div>

            {/* Opening */}
            <div>
              <label className={labelCls} style={fontLabel}>Opening prose (turn 0)</label>
              <textarea value={spec.opening.prose} onChange={(e) => patchSpec({ opening: { ...spec.opening, prose: e.target.value } })} rows={5} className={inputCls} style={inputStyle} />
              <label className={`${labelCls} mt-2`} style={fontLabel}>Starter actions</label>
              {spec.opening.actions.map((a, i) => (
                <div key={i} className="mb-1 flex gap-2">
                  <input value={a} onChange={(e) => patchSpec({ opening: { ...spec.opening, actions: spec.opening.actions.map((x, j) => (j === i ? e.target.value : x)) } })} className={inputCls} style={inputStyle} />
                  <button onClick={() => patchSpec({ opening: { ...spec.opening, actions: spec.opening.actions.filter((_, j) => j !== i) } })} className="text-xs text-red-300">✕</button>
                </div>
              ))}
              <button onClick={() => patchSpec({ opening: { ...spec.opening, actions: [...spec.opening.actions, ''] } })} className={`${ghostBtn} mt-1`} style={ghostBtnStyle}>+ action</button>
            </div>

            {/* Durable end-state — facts written into the wiki when this chapter ends. */}
            <div>
              <label className={labelCls} style={fontLabel}>Durable end-state</label>
              <p className="mb-2 text-xs text-text-dim" style={fontBody}>
                Field names must start with <code className="text-[var(--color-gold)]">chapterend_</code>.
                These facts outlive the chapter and persist into later chapters.
              </p>
              {(spec.endState ?? []).map((op, oi) => {
                const hint = endStateHints[op.field]
                const mismatch = hint && hint.op !== op.op
                return (
                  <div key={oi} className="mb-1 flex flex-wrap items-center gap-2">
                    <input
                      value={op.field}
                      onChange={(e) =>
                        patchSpec({
                          endState: (spec.endState ?? []).map((x, j) => (j === oi ? { ...x, field: e.target.value } : x)),
                        })
                      }
                      placeholder="field"
                      className={`${inputCls} w-40`}
                      style={{ ...inputStyle, ...(mismatch ? { borderColor: 'var(--color-gold)' } : {}) }}
                    />
                    {hint && (
                      <span
                        className={`text-[10px] ${mismatch ? 'text-[var(--color-gold)]' : 'text-text-muted'}`}
                        style={fontBody}
                      >
                        ch.{hint.chapterNumber} uses this ({hint.op === 'append' ? 'list' : 'flag'}
                        {mismatch ? ' — different op!' : ''})
                      </span>
                    )}
                    <select
                      value={op.op}
                      onChange={(e) =>
                        patchSpec({
                          endState: (spec.endState ?? []).map((x, j) =>
                            j === oi ? { ...x, op: e.target.value as EndStateOp['op'] } : x,
                          ),
                        })
                      }
                      className={`${inputCls} w-28`}
                      style={inputStyle}
                    >
                      <option value="set">set</option>
                      <option value="append">append</option>
                    </select>
                    <input
                      value={typeof op.value === 'string' ? op.value : op.value === true ? 'true' : op.value === false ? 'false' : op.value === null || op.value === undefined ? '' : String(op.value)}
                      onChange={(e) => {
                        const raw = e.target.value
                        // Parse common value types: bool, number, or string.
                        let parsed: unknown = raw
                        if (raw === 'true') parsed = true
                        else if (raw === 'false') parsed = false
                        else if (raw !== '' && !isNaN(Number(raw))) parsed = Number(raw)
                        patchSpec({
                          endState: (spec.endState ?? []).map((x, j) => (j === oi ? { ...x, value: parsed } : x)),
                        })
                      }}
                      placeholder="value"
                      className={`${inputCls} flex-1`}
                      style={inputStyle}
                    />
                    <button
                      onClick={() =>
                        patchSpec({ endState: (spec.endState ?? []).filter((_, j) => j !== oi) })
                      }
                      className="text-xs text-red-300"
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
              <button
                onClick={() =>
                  patchSpec({ endState: [...(spec.endState ?? []), { field: 'chapterend_', op: 'set', value: '' }] })
                }
                className={`${ghostBtn} mt-1`}
                style={ghostBtnStyle}
              >
                + end-state fact
              </button>
            </div>

            {/* Re-expand with notes */}
            <details className="rounded-sm border p-3" style={{ borderColor: 'var(--color-gold-mid)' }}>
              <summary className="cursor-pointer text-sm text-text-muted" style={fontBody}>Not quite right? Re-expand with notes</summary>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. make the second beat darker; add a third condition to beat 1" rows={2} className={`${inputCls} mt-2`} style={inputStyle} />
              <button onClick={expand} disabled={busy} className={`${ghostBtn} mt-2`} style={ghostBtnStyle}>{busy ? 'Re-expanding…' : 'Re-expand with AI'}</button>
            </details>

            <div className="flex items-center gap-3">
              <button onClick={save} disabled={busy} className={`${primaryBtnCls} px-[28px] py-3`} style={goldBtnStyle}>
                {busy ? 'Saving…' : 'Save chapter (go live)'}
              </button>
              <button onClick={startNew} className={ghostBtn} style={ghostBtnStyle}>Start over</button>
            </div>
          </div>
        )}

        {/* ── Existing authored chapters ─────────────────────────────────── */}
        <div className="mt-10 pt-5" style={{ borderTop: '1px solid var(--color-gold-mid)' }}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-muted" style={fontBody}>Authored chapters</h2>
            {stage === 'review' && <button onClick={startNew} className={ghostBtn} style={ghostBtnStyle}>+ New chapter</button>}
          </div>
          {list.length === 0 ? (
            <p className="text-xs text-text-dim" style={fontBody}>None yet. Built-in Chapter 1 is always present and not editable here.</p>
          ) : (
            <div className="space-y-2">
              {list.map((c) => (
                <div
                  key={c.number}
                  className="flex items-center justify-between rounded-sm border p-3"
                  style={{
                    background: 'var(--color-bg-card)',
                    borderColor: 'var(--color-gold-mid)',
                  }}
                >
                  <span className="text-sm text-text-primary" style={fontBody}>Ch {c.number} · {c.title || '(untitled)'}</span>
                  <div className="flex gap-2">
                    <button onClick={() => editChapter(c.number)} className={ghostBtn} style={ghostBtnStyle}>Edit</button>
                    <button onClick={() => deleteChapter(c.number)} className="border rounded-sm px-3 py-2 text-xs text-red-300 transition hover:bg-red-400/10" style={{ borderColor: 'oklch(0.55 0.12 25 / 0.4)' }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
