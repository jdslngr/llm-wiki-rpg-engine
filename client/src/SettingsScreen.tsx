import { useEffect, useState } from 'react'

interface Props {
  onBack: () => void
}

type SettingsData = {
  keyMode: 'hosted' | 'byok'
  llmProvider: string | null
  llmModel: string | null
  llmBaseUrl: string | null
  hostedCredits: number
}

// Providers we natively support without extra config.
// "Other" surfaces the base URL field for any OpenAI-compatible endpoint.
const PROVIDERS = [
  { value: 'openrouter', label: 'OpenRouter', needsBaseUrl: false },
  { value: 'openai', label: 'OpenAI', needsBaseUrl: false },
  { value: 'other', label: 'Other (Venice, Groq, Together, local …)', needsBaseUrl: true },
]

function isOtherProvider(prov: string): boolean {
  return !['openrouter', 'openai'].includes(prov)
}

export default function SettingsScreen({ onBack }: Props) {
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  // Editable fields (seeded from server, then tracked locally)
  const [keyMode, setKeyMode] = useState<'hosted' | 'byok'>('hosted')
  const [provider, setProvider] = useState('openrouter')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/auth/settings')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Could not load settings.')
        setSettings(data)
        setKeyMode(data.keyMode ?? 'hosted')
        setProvider(data.llmProvider || 'openrouter')
        setModel(data.llmModel || '')
        setBaseUrl(data.llmBaseUrl || '')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load settings.')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function handleTestKey() {
    if (!apiKey.trim()) {
      setError('Paste an API key first.')
      return
    }
    setTesting(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/auth/settings/validate-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, key: apiKey.trim(), baseUrl: baseUrl || undefined }),
      })
      const data = await res.json()
      if (res.ok) {
        setMessage('Key is valid!')
      } else {
        setError(data.error ?? 'Key validation failed.')
      }
    } catch {
      setError('Could not reach the server to test the key.')
    } finally {
      setTesting(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const body: Record<string, unknown> = {
        keyMode,
        llmProvider: provider || null,
        llmModel: model || null,
        llmBaseUrl: baseUrl || null,
      }
      if (keyMode === 'byok' && apiKey.trim()) {
        body.llmKey = apiKey.trim()
      }
      const res = await fetch('/api/auth/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not save settings.')
      setSettings(data)
      setApiKey('') // clear the key field — it's stored server-side now
      setMessage('Settings saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings.')
    } finally {
      setSaving(false)
    }
  }

  const fontTitle: React.CSSProperties = { fontFamily: "'Cinzel', Georgia, serif", letterSpacing: '0.04em' }
  const fontBody: React.CSSProperties = { fontFamily: "'Lora', Georgia, serif" }
  const fontLabel: React.CSSProperties = { fontFamily: "'Lora', Georgia, serif", fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.12em' }

  const inputCls = 'w-full rounded-sm border px-[14px] text-sm text-text-primary disabled:opacity-50'
  const inputStyle: React.CSSProperties = {
    background: 'var(--color-bg-input)',
    borderColor: 'var(--color-gold-mid)',
    fontFamily: "'Lora', Georgia, serif",
    height: '44px',
  }

  const panelStyle: React.CSSProperties = {
    background: 'linear-gradient(155deg, oklch(0.265 0.046 149), oklch(0.235 0.050 152))',
    boxShadow: '0 28px 72px rgba(0,0,0,0.55), 0 8px 24px rgba(0,0,0,0.36), 0 0 0 1px var(--color-gold-border), inset 0 1px 0 rgba(255,220,80,0.10)',
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-text-muted">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-start justify-center p-4 pt-12">
      <div
        className="w-full max-w-[700px] rounded p-[36px_40px_32px]"
        style={panelStyle}
      >
        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h1 className="text-[26px] font-medium text-text-primary" style={fontTitle}>Settings</h1>
            <p className="mt-1 text-sm italic text-text-muted" style={fontBody}>API keys &amp; cost controls</p>
          </div>
          <button
            onClick={onBack}
            className="text-sm text-gold-text hover:opacity-80 transition"
            style={fontBody}
          >
            Back
          </button>
        </div>

        {error && <div className="mb-4 border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400 rounded-sm">{error}</div>}
        {message && <div className="mb-4 border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-400 rounded-sm">{message}</div>}

        {/* Credits display — always visible */}
        {settings && (
          <div
            className="mb-6 flex items-center justify-between rounded-sm border p-[18px_22px]"
            style={{
              background: 'var(--color-bg-card)',
              borderColor: 'var(--color-gold-mid)',
            }}
          >
            <div>
              <p className="text-[15px] font-medium text-text-primary" style={fontBody}>Hosted credits</p>
              <p className="text-[13px] text-text-muted" style={fontBody}>
                {keyMode === 'hosted'
                  ? 'You are playing on the shared key.'
                  : 'You are using your own key — credits are not consumed.'}
              </p>
            </div>
            <div className="text-right">
              <span className="text-[28px] font-semibold text-text-primary" style={{ fontFamily: "'Cinzel', Georgia, serif" }}>
                {settings.hostedCredits}
              </span>
              <p className="text-xs text-text-muted" style={fontBody}>turns remaining</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-5">
          {/* Key mode toggle */}
          <fieldset>
            <legend className="mb-2 text-xs text-text-muted" style={fontLabel}>Key source</legend>
            <div className="flex gap-3">
              <label
                className={`flex-1 cursor-pointer rounded-sm border p-4 text-center transition ${
                  keyMode === 'hosted'
                    ? ''
                    : 'hover:border-gold-mid/70'
                }`}
                style={{
                  background: keyMode === 'hosted' ? 'oklch(0.255 0.050 149)' : 'var(--color-bg-card)',
                  borderColor: keyMode === 'hosted' ? 'var(--color-gold-border)' : 'var(--color-gold-mid)',
                }}
              >
                <input
                  type="radio"
                  name="keyMode"
                  value="hosted"
                  checked={keyMode === 'hosted'}
                  onChange={() => setKeyMode('hosted')}
                  className="sr-only"
                />
                <span className="text-sm font-medium text-text-primary" style={{ fontFamily: "'Cinzel', Georgia, serif" }}>
                  Hosted
                </span>
                <p className="mt-0.5 text-[11px] text-text-muted" style={fontBody}>Use shared key</p>
              </label>
              <label
                className={`flex-1 cursor-pointer rounded-sm border p-4 text-center transition ${
                  keyMode === 'byok'
                    ? ''
                    : 'hover:border-gold-mid/70'
                }`}
                style={{
                  background: keyMode === 'byok' ? 'oklch(0.255 0.050 149)' : 'var(--color-bg-card)',
                  borderColor: keyMode === 'byok' ? 'var(--color-gold-border)' : 'var(--color-gold-mid)',
                }}
              >
                <input
                  type="radio"
                  name="keyMode"
                  value="byok"
                  checked={keyMode === 'byok'}
                  onChange={() => setKeyMode('byok')}
                  className="sr-only"
                />
                <span className="text-sm text-text-muted" style={{ fontFamily: "'Cinzel', Georgia, serif" }}>
                  Bring your own
                </span>
                <p className="mt-0.5 text-[11px] text-text-muted" style={fontBody}>Use your key</p>
              </label>
            </div>
          </fieldset>

          {/* BYOK fields — only shown when BYOK is selected */}
          {keyMode === 'byok' && (
            <>
              <div>
                <label className="mb-[7px] block" style={fontLabel} htmlFor="settings-provider">
                  Provider
                </label>
                <select
                  id="settings-provider"
                  value={isOtherProvider(provider) ? 'other' : provider}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val === 'other') {
                      setProvider('')  // clear so user types their own
                    } else {
                      setProvider(val)
                      setBaseUrl('')   // clear base URL when switching to a known provider
                    }
                  }}
                  className={inputCls}
                  style={inputStyle}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {isOtherProvider(provider) && (
                  <p className="mt-1 text-[11px] text-text-dim" style={fontBody}>
                    Any OpenAI-compatible endpoint. OpenRouter is recommended for multi-model access.
                  </p>
                )}
              </div>

              {/* Custom provider name — only for "Other" */}
              {isOtherProvider(provider) && (
                <div>
                  <label className="mb-[7px] block" style={fontLabel} htmlFor="settings-provider-name">
                    Provider name
                  </label>
                  <input
                    id="settings-provider-name"
                    type="text"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    placeholder="venice"
                    autoComplete="off"
                    className={inputCls}
                    style={inputStyle}
                  />
                  <p className="mt-1 text-[11px] text-text-dim" style={fontBody}>
                    A short lowercase name (e.g. venice, groq, together, lmstudio).
                  </p>
                </div>
              )}

              <div>
                <label className="mb-[7px] block" style={fontLabel} htmlFor="settings-model">
                  Model
                </label>
                <input
                  id="settings-model"
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={
                    provider === 'openrouter' ? 'anthropic/claude-sonnet-4.6' :
                    provider === 'openai' ? 'gpt-4o' :
                    'llama-3.3-70b'
                  }
                  autoComplete="off"
                  className={inputCls}
                  style={inputStyle}
                />
                <p className="mt-1 text-[11px] text-text-dim" style={fontBody}>
                  Model ID in the provider's format.
                </p>
              </div>

              {/* Base URL — only for "Other" */}
              {isOtherProvider(provider) && (
                <div>
                  <label className="mb-[7px] block" style={fontLabel} htmlFor="settings-base-url">
                    Base URL
                  </label>
                  <input
                    id="settings-base-url"
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.venice.ai/v1"
                    autoComplete="off"
                    className={inputCls}
                    style={inputStyle}
                  />
                  <p className="mt-1 text-[11px] text-text-dim" style={fontBody}>
                    The API endpoint. Leave blank for the provider's default.
                  </p>
                </div>
              )}

              <div>
                <label className="mb-[7px] block" style={fontLabel} htmlFor="settings-key">
                  API key
                </label>
                <input
                  id="settings-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-…"
                  autoComplete="off"
                  className={inputCls}
                  style={inputStyle}
                />
                <p className="mt-1 text-[11px] text-text-dim" style={fontBody}>
                  Your key is encrypted before storage and never returned to the browser.
                </p>
              </div>

              <button
                type="button"
                onClick={handleTestKey}
                disabled={testing || !apiKey.trim()}
                className="w-full rounded-sm border px-5 py-3 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  borderColor: 'var(--color-gold-mid)',
                  color: 'var(--color-text-muted)',
                  fontFamily: "'Lora', Georgia, serif",
                }}
              >
                {testing ? 'Testing…' : 'Test key'}
              </button>
            </>
          )}

          {/* Privacy notice */}
          <div
            className="rounded-sm border p-[16px_20px] text-[13px] leading-relaxed text-text-muted"
            style={{
              background: 'var(--color-bg-card)',
              borderColor: 'var(--color-gold-mid)',
              fontFamily: "'Lora', Georgia, serif",
              lineHeight: '1.7',
            }}
          >
            <p className="font-medium text-gold-text" style={fontBody}>🔒 Privacy</p>
            <p className="mt-1">
              API keys you provide are encrypted with AES-256-GCM before being stored.
              They are never returned to the browser after saving, never logged, and never
              shared. Only the server — with its secret key — can decrypt them at turn time.
            </p>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full h-[50px] rounded-sm text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: 'linear-gradient(180deg, var(--color-gold) 0%, var(--color-gold-dark) 100%)',
              color: 'oklch(0.17 0.050 150)',
              fontFamily: "'Lora', Georgia, serif",
              letterSpacing: '0.06em',
              boxShadow: '0 2px 8px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,228,110,0.25)',
            }}
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </form>
      </div>
    </div>
  )
}
