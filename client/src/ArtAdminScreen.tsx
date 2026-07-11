interface Props {
  onBack: () => void
}

export default function ArtAdminScreen({ onBack }: Props) {
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
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-[26px] font-medium text-text-primary" style={fontTitle}>
            Manage Art
          </h1>
          <button
            onClick={onBack}
            className="text-sm text-gold-text hover:opacity-80 transition"
            style={fontBody}
          >
            ← Back to Saves
          </button>
        </div>
        <p className="text-sm text-text-muted" style={fontBody}>
          Art management coming soon.
        </p>
      </div>
    </div>
  )
}
