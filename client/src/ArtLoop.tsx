import type { ArtAsset } from './types'

interface Props {
  art: ArtAsset
  className?: string
  style?: React.CSSProperties
}

/**
 * Shared art renderer that branches on MIME type:
 * - image/* → <img>
 * - video/mp4 → <video autoPlay muted loop playsInline>
 *
 * Used by desktop rails and mobile inline beat art in GameScreen,
 * and may be reused by other screens.
 */
export default function ArtLoop({ art, className, style }: Props) {
  if (art.mimeType.startsWith('image/')) {
    return <img src={art.url} alt={art.label} className={className} style={style} />
  }

  return (
    <video
      src={art.url}
      autoPlay
      muted
      loop
      playsInline
      aria-label={art.label}
      className={className}
      style={style}
    />
  )
}
