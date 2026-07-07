import { useState } from 'react'

interface Props {
  onSignup: (username: string) => void
  onGoToLogin: () => void
}

export default function SignupScreen({ onSignup, onGoToLogin }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password) return
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not create account.')
      onSignup(data.user.username)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create account.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[100svh] items-center justify-center p-4">
      <div
        className="flex w-full max-w-[710px] overflow-hidden rounded"
        style={{
          background: 'linear-gradient(155deg, oklch(0.265 0.046 149), oklch(0.235 0.050 152))',
          boxShadow: '0 28px 72px rgba(0,0,0,0.55), 0 8px 24px rgba(0,0,0,0.36), 0 0 0 1px var(--color-gold-border), inset 0 1px 0 rgba(255,220,80,0.10)',
        }}
      >
        {/* Artwork — lighthouse illustration by Hansel */}
        <div className="hidden w-[310px] shrink-0 relative sm:block">
          <img
            src="/art/lighthouse-daytime.jpg"
            alt="Lighthouse illustration by Hansel"
            className="absolute inset-0 w-full h-full object-cover"
          />
        </div>

        {/* Signup form */}
        <div className="flex-1 px-[42px] py-[46px] pb-10">
          <h1 className="mb-1 text-[21px] font-medium text-text-primary" style={{ fontFamily: "'Cinzel', Georgia, serif", letterSpacing: '0.04em' }}>
            Archipelago Lighthouse
          </h1>
          <p className="mb-6 text-sm text-text-muted" style={{ fontFamily: "'Lora', Georgia, serif" }}>
            Create your account
          </p>

          {/* Ornamental divider */}
          <div className="mb-[30px] flex items-center gap-2.5">
            <div className="flex-1 h-px" style={{ background: 'linear-gradient(to right, transparent, var(--color-gold-mid))' }} />
            <div className="w-[5px] h-[5px] rotate-45" style={{ background: 'var(--color-gold-border)' }} />
            <div className="flex-1 h-px" style={{ background: 'linear-gradient(to left, transparent, var(--color-gold-mid))' }} />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                className="mb-[7px] block text-[11px] uppercase text-text-muted"
                htmlFor="signup-username"
                style={{ fontFamily: "'Lora', Georgia, serif", letterSpacing: '0.12em' }}
              >
                Username
              </label>
              <input
                id="signup-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                disabled={loading}
                className="w-full rounded-sm border px-[14px] text-sm text-text-primary placeholder:text-text-dim/70 disabled:opacity-50"
                style={{
                  background: 'var(--color-bg-input)',
                  borderColor: 'var(--color-gold-mid)',
                  fontFamily: "'Lora', Georgia, serif",
                  height: '44px',
                }}
              />
              <p className="mt-1 text-[11px] text-text-muted" style={{ fontFamily: "'Lora', Georgia, serif" }}>
                3–30 characters, letters, numbers, and underscores
              </p>
            </div>

            <div>
              <label
                className="mb-[7px] block text-[11px] uppercase text-text-muted"
                htmlFor="signup-password"
                style={{ fontFamily: "'Lora', Georgia, serif", letterSpacing: '0.12em' }}
              >
                Password
              </label>
              <input
                id="signup-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                disabled={loading}
                className="w-full rounded-sm border px-[14px] text-sm text-text-primary placeholder:text-text-dim/70 disabled:opacity-50"
                style={{
                  background: 'var(--color-bg-input)',
                  borderColor: 'var(--color-gold-mid)',
                  fontFamily: "'Lora', Georgia, serif",
                  height: '44px',
                }}
              />
              <p className="mt-1 text-[11px] text-text-muted" style={{ fontFamily: "'Lora', Georgia, serif" }}>
                At least 8 characters
              </p>
            </div>

            <div>
              <label
                className="mb-[7px] block text-[11px] uppercase text-text-muted"
                htmlFor="signup-confirm"
                style={{ fontFamily: "'Lora', Georgia, serif", letterSpacing: '0.12em' }}
              >
                Confirm password
              </label>
              <input
                id="signup-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                disabled={loading}
                className="w-full rounded-sm border px-[14px] text-sm text-text-primary placeholder:text-text-dim/70 disabled:opacity-50"
                style={{
                  background: 'var(--color-bg-input)',
                  borderColor: 'var(--color-gold-mid)',
                  fontFamily: "'Lora', Georgia, serif",
                  height: '44px',
                }}
              />
            </div>

            {error && <div className="text-sm text-red-400">{error}</div>}

            <button
              type="submit"
              disabled={loading || !username.trim() || !password || !confirmPassword}
              className="w-full rounded-sm border-0 px-5 text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: 'linear-gradient(180deg, var(--color-gold) 0%, var(--color-gold-dark) 100%)',
                color: 'oklch(0.17 0.050 150)',
                fontFamily: "'Lora', Georgia, serif",
                letterSpacing: '0.08em',
                height: '50px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,228,110,0.25)',
              }}
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-text-muted">
            Already have an account?{' '}
            <button
              onClick={onGoToLogin}
              className="text-gold-text underline underline-offset-[2px] transition hover:opacity-80"
              style={{ fontFamily: "'Lora', Georgia, serif" }}
            >
              Log in
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
