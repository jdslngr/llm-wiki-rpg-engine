// Filesystem-backed art registry for curated chapter/beat art.
// Stores metadata in server/data/art/registry.json and binary files under
// server/data/art/beats/chapter-<N>/. The API layer owns auth and unlock checks.

import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export type ArtKind = 'chapter' | 'beat'

export type ArtMimeType =
  | 'video/mp4'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/gif'
  | 'image/avif'

export type ArtAsset = {
  id: string
  kind: ArtKind
  chapterNumber: number
  anchor: string | null
  title: string
  label: string
  filename: string
  url: string
  mimeType: ArtMimeType
  sizeBytes: number
  updatedAt: string
  updatedBy: string | null
}

const MIME_EXTENSIONS: Record<ArtMimeType, string> = {
  'video/mp4': 'mp4',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

function isArtMimeType(value: string): value is ArtMimeType {
  return Object.hasOwn(MIME_EXTENSIONS, value)
}

function extForMime(mimeType: string): string {
  if (isArtMimeType(mimeType)) return MIME_EXTENSIONS[mimeType]
  throw new Error(`Unsupported MIME type: ${mimeType}`)
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function safePart(value: string, label: string): string {
  if (!value || typeof value !== 'string') {
    throw new Error(`${label} must be a non-empty string`)
  }
  if (value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new Error(`${label} contains invalid characters: ${JSON.stringify(value)}`)
  }
  return value
}

function assertChapterNumber(chapterNumber: number): void {
  if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
    throw new Error(`chapterNumber must be a positive integer, got ${chapterNumber}`)
  }
}

function sortAssets(assets: ArtAsset[]): ArtAsset[] {
  return [...assets].sort((a, b) => {
    if (a.chapterNumber !== b.chapterNumber) return a.chapterNumber - b.chapterNumber
    if (a.kind !== b.kind) return a.kind === 'chapter' ? -1 : 1
    return (a.anchor ?? '').localeCompare(b.anchor ?? '')
  })
}

export class ArtStore {
  readonly artDir: string

  constructor(artDir?: string) {
    this.artDir = artDir ?? process.env.ART_DIR ?? path.resolve(process.cwd(), 'data', 'art')
  }

  private get registryPath(): string {
    return path.join(this.artDir, 'registry.json')
  }

  private chapterDir(chapterNumber: number): string {
    assertChapterNumber(chapterNumber)
    return path.join(this.artDir, 'beats', `chapter-${chapterNumber}`)
  }

  private artFilename(kind: ArtKind, anchor: string | null, anchorTitle: string | null, mimeType: ArtMimeType): string {
    const ext = extForMime(mimeType)
    if (kind === 'chapter') return `chapter-art.${ext}`

    const safeAnchor = safePart(anchor ?? '', 'anchor')
    const slug = slugify(anchorTitle ?? safeAnchor) || safeAnchor.toLowerCase()
    return `${safeAnchor.toLowerCase()}-${slug}.${ext}`
  }

  async readRegistry(): Promise<ArtAsset[]> {
    try {
      const raw = await fs.readFile(this.registryPath, 'utf-8')
      const parsed = JSON.parse(raw) as ArtAsset[]
      return sortAssets(parsed)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }

  private async writeRegistry(assets: ArtAsset[]): Promise<void> {
    await fs.mkdir(this.artDir, { recursive: true })
    const tmp = `${this.registryPath}.tmp`
    await fs.writeFile(tmp, JSON.stringify(sortAssets(assets), null, 2), 'utf-8')

    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(tmp, this.registryPath)
        return
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code
        if ((code === 'EPERM' || code === 'EBUSY') && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)))
          continue
        }
        throw err
      }
    }
  }

  async listChapterArt(chapterNumber: number): Promise<ArtAsset[]> {
    assertChapterNumber(chapterNumber)
    const all = await this.readRegistry()
    return all.filter((asset) => asset.chapterNumber === chapterNumber)
  }

  async getBeatArt(chapterNumber: number, anchor: string): Promise<ArtAsset | null> {
    assertChapterNumber(chapterNumber)
    const safeAnchor = safePart(anchor, 'anchor')
    const all = await this.readRegistry()
    return (
      all.find(
        (asset) =>
          asset.kind === 'beat' &&
          asset.chapterNumber === chapterNumber &&
          asset.anchor === safeAnchor,
      ) ?? null
    )
  }

  async getArtById(id: string): Promise<ArtAsset | null> {
    const safeId = safePart(id, 'art id')
    const all = await this.readRegistry()
    return all.find((asset) => asset.id === safeId) ?? null
  }

  async upsertArt(params: {
    chapterNumber: number
    anchor: string | null
    anchorTitle?: string
    chapterTitle?: string
    fileBuffer: Buffer
    mimeType: ArtMimeType
    updatedBy: string | null
  }): Promise<ArtAsset> {
    const { chapterNumber, anchor, anchorTitle, chapterTitle, fileBuffer, mimeType, updatedBy } = params
    assertChapterNumber(chapterNumber)
    if (!isArtMimeType(mimeType)) throw new Error(`Unsupported MIME type: ${mimeType}`)

    const kind: ArtKind = anchor ? 'beat' : 'chapter'
    const safeAnchor = anchor ? safePart(anchor, 'anchor') : null
    const filename = this.artFilename(kind, safeAnchor, anchorTitle ?? null, mimeType)
    const dir = this.chapterDir(chapterNumber)
    const filePath = path.join(dir, filename)

    const label =
      kind === 'chapter'
        ? `Chapter ${chapterNumber} art`
        : `${safeAnchor} - ${anchorTitle ?? safeAnchor}`
    const title =
      kind === 'chapter'
        ? chapterTitle ?? `Chapter ${chapterNumber}`
        : anchorTitle ?? `${safeAnchor}`

    await fs.mkdir(dir, { recursive: true })

    const assets = await this.readRegistry()
    const existingIdx = assets.findIndex(
      (asset) =>
        asset.kind === kind &&
        asset.chapterNumber === chapterNumber &&
        asset.anchor === safeAnchor,
    )

    if (existingIdx !== -1) {
      const oldPath = this.filePathFor(assets[existingIdx])
      try {
        await fs.unlink(oldPath)
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    }

    await fs.writeFile(filePath, fileBuffer)

    const now = new Date().toISOString()
    const asset: ArtAsset = {
      id: existingIdx !== -1 ? assets[existingIdx].id : randomUUID(),
      kind,
      chapterNumber,
      anchor: safeAnchor,
      title,
      label,
      filename,
      url: '',
      mimeType,
      sizeBytes: fileBuffer.length,
      updatedAt: now,
      updatedBy,
    }

    if (existingIdx !== -1) assets[existingIdx] = asset
    else assets.push(asset)

    await this.writeRegistry(assets)
    return asset
  }

  filePathFor(asset: ArtAsset): string {
    assertChapterNumber(asset.chapterNumber)
    const filename = safePart(asset.filename, 'filename')
    const resolved = path.resolve(this.chapterDir(asset.chapterNumber), filename)
    const chapterDir = path.resolve(this.chapterDir(asset.chapterNumber))
    if (!resolved.startsWith(`${chapterDir}${path.sep}`)) {
      throw new Error(`asset path escapes art directory: ${asset.filename}`)
    }
    return resolved
  }

  async deleteArt(id: string): Promise<boolean> {
    const safeId = safePart(id, 'art id')
    const assets = await this.readRegistry()
    const idx = assets.findIndex((asset) => asset.id === safeId)
    if (idx === -1) return false

    const asset = assets[idx]
    try {
      await fs.unlink(this.filePathFor(asset))
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }

    assets.splice(idx, 1)
    await this.writeRegistry(assets)
    return true
  }
}

export const artStore = new ArtStore()