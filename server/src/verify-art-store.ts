// Hermetic verifier for the filesystem art store.
// Run from server/: npm exec -- tsx src/verify-art-store.ts

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ArtStore, type ArtMimeType } from './artStore.js'

let failed = 0

async function check(description: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`  ok - ${description}`)
  } catch (err: unknown) {
    failed++
    console.error(`  FAIL - ${description}`)
    console.error(`    ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function expectMissing(filePath: string): Promise<void> {
  try {
    await fs.stat(filePath)
    throw new Error(`expected missing file, but it exists: ${filePath}`)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

async function run(): Promise<void> {
  const tmpDir = path.join(os.tmpdir(), `art-store-verify-${Date.now()}`)
  const store = new ArtStore(tmpDir)

  console.log(`[verify-art-store] temp dir: ${tmpDir}\n`)

  await check('empty registry returns []', async () => {
    const all = await store.readRegistry()
    if (all.length !== 0) throw new Error(`expected 0, got ${all.length}`)
  })

  const chapterBuf = Buffer.from('fake-chapter-art-content')
  const chapterArt = await store.upsertArt({
    chapterNumber: 1,
    anchor: null,
    chapterTitle: 'The Lighthouse',
    fileBuffer: chapterBuf,
    mimeType: 'video/mp4',
    updatedBy: 'verifier',
  })

  await check('upsert chapter art creates asset', () => {
    if (chapterArt.kind !== 'chapter') throw new Error('expected chapter kind')
    if (chapterArt.chapterNumber !== 1) throw new Error('expected chapter 1')
    if (chapterArt.anchor !== null) throw new Error('expected null anchor')
    if (chapterArt.filename !== 'chapter-art.mp4') throw new Error(`unexpected filename ${chapterArt.filename}`)
    if (chapterArt.sizeBytes !== chapterBuf.length) throw new Error('sizeBytes mismatch')
    if (!chapterArt.id) throw new Error('missing id')
    if (!chapterArt.updatedAt) throw new Error('missing updatedAt')
  })

  await check('chapter art file exists on disk', async () => {
    const stat = await fs.stat(path.join(tmpDir, 'beats', 'chapter-1', 'chapter-art.mp4'))
    if (stat.size !== chapterBuf.length) throw new Error('file size mismatch')
  })

  await check('registry has 1 entry after chapter art upsert', async () => {
    const all = await store.readRegistry()
    if (all.length !== 1) throw new Error(`expected 1, got ${all.length}`)
  })

  const beatBuf = Buffer.from('fake-beat-art-content')
  const beatArt = await store.upsertArt({
    chapterNumber: 1,
    anchor: 'A1',
    anchorTitle: 'Lighthouse Morning',
    chapterTitle: 'The Lighthouse',
    fileBuffer: beatBuf,
    mimeType: 'image/webp',
    updatedBy: 'verifier',
  })

  await check('upsert beat art creates asset', () => {
    if (beatArt.kind !== 'beat') throw new Error('expected beat kind')
    if (beatArt.anchor !== 'A1') throw new Error('expected A1 anchor')
    if (beatArt.filename !== 'a1-lighthouse-morning.webp') {
      throw new Error(`expected a1-lighthouse-morning.webp, got ${beatArt.filename}`)
    }
  })

  await check('registry has 2 entries after beat art upsert', async () => {
    const all = await store.readRegistry()
    if (all.length !== 2) throw new Error(`expected 2, got ${all.length}`)
  })

  await check('listChapterArt returns both assets', async () => {
    const list = await store.listChapterArt(1)
    if (list.length !== 2) throw new Error(`expected 2, got ${list.length}`)
  })

  await check('listChapterArt for unknown chapter returns []', async () => {
    const list = await store.listChapterArt(99)
    if (list.length !== 0) throw new Error(`expected 0, got ${list.length}`)
  })

  await check('getBeatArt returns matching beat', async () => {
    const found = await store.getBeatArt(1, 'A1')
    if (!found) throw new Error('expected asset')
    if (found.anchor !== 'A1') throw new Error('wrong anchor')
  })

  await check('getBeatArt for missing anchor returns null', async () => {
    const found = await store.getBeatArt(1, 'A9')
    if (found !== null) throw new Error('expected null')
  })

  await check('getArtById returns asset', async () => {
    const found = await store.getArtById(chapterArt.id)
    if (!found) throw new Error('expected asset')
    if (found.id !== chapterArt.id) throw new Error('id mismatch')
  })

  await check('getArtById for missing id returns null', async () => {
    const found = await store.getArtById('nonexistent')
    if (found !== null) throw new Error('expected null')
  })

  const oldBeatFilename = beatArt.filename
  const oldBeatId = beatArt.id
  const newBeatBuf = Buffer.from('replacement-beat-content')
  const replacedBeat = await store.upsertArt({
    chapterNumber: 1,
    anchor: 'A1',
    anchorTitle: 'Lighthouse Sunrise',
    chapterTitle: 'The Lighthouse',
    fileBuffer: newBeatBuf,
    mimeType: 'image/png',
    updatedBy: 'verifier',
  })

  await check('replacing beat art keeps same id', () => {
    if (replacedBeat.id !== oldBeatId) throw new Error('id changed on replace')
    if (replacedBeat.sizeBytes !== newBeatBuf.length) throw new Error('sizeBytes not updated')
    if (replacedBeat.filename !== 'a1-lighthouse-sunrise.png') throw new Error(`unexpected filename ${replacedBeat.filename}`)
  })

  await check('replacing beat art deletes old file', async () => {
    await expectMissing(path.join(tmpDir, 'beats', 'chapter-1', oldBeatFilename))
  })

  await check('new beat file has replacement content', async () => {
    const content = await fs.readFile(path.join(tmpDir, 'beats', 'chapter-1', replacedBeat.filename))
    if (!content.equals(newBeatBuf)) throw new Error('file content mismatch')
  })

  await check('deleteArt removes metadata and file', async () => {
    const ok = await store.deleteArt(chapterArt.id)
    if (!ok) throw new Error('deleteArt returned false')
    const all = await store.readRegistry()
    if (all.length !== 1) throw new Error(`expected 1 remaining, got ${all.length}`)
    await expectMissing(path.join(tmpDir, 'beats', 'chapter-1', 'chapter-art.mp4'))
  })

  await check('deleteArt for missing id returns false', async () => {
    const ok = await store.deleteArt('nonexistent')
    if (ok) throw new Error('expected false')
  })

  await check('safePart rejects slashes in anchor', async () => {
    try {
      await store.upsertArt({
        chapterNumber: 1,
        anchor: '../etc/passwd',
        anchorTitle: 'bad',
        fileBuffer: Buffer.from('x'),
        mimeType: 'video/mp4',
        updatedBy: null,
      })
      throw new Error('expected rejection but upsert succeeded')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.includes('invalid characters')) throw new Error(`wrong error: ${message}`)
    }
  })

  await check('slugify strips special characters', async () => {
    const art = await store.upsertArt({
      chapterNumber: 2,
      anchor: 'A2',
      anchorTitle: 'Hello / World \\ .. %',
      fileBuffer: Buffer.from('safe'),
      mimeType: 'video/mp4',
      updatedBy: null,
    })
    const expected = 'a2-hello-world.mp4'
    if (art.filename !== expected) throw new Error(`expected ${expected}, got ${art.filename}`)
    await store.deleteArt(art.id)
  })

  await check('missing registry file behaves as empty registry', async () => {
    const emptyStore = new ArtStore(path.join(tmpDir, 'fresh-subdir'))
    const all = await emptyStore.readRegistry()
    if (all.length !== 0) throw new Error(`expected 0, got ${all.length}`)
  })

  const mimeCases: { mimeType: ArtMimeType; expected: string }[] = [
    { mimeType: 'image/jpeg', expected: 'chapter-art.jpg' },
    { mimeType: 'image/png', expected: 'chapter-art.png' },
    { mimeType: 'image/webp', expected: 'chapter-art.webp' },
    { mimeType: 'image/gif', expected: 'chapter-art.gif' },
    { mimeType: 'image/avif', expected: 'chapter-art.avif' },
  ]

  for (const [idx, { mimeType, expected }] of mimeCases.entries()) {
    await check(`supported MIME ${mimeType} maps to ${expected}`, async () => {
      const art = await store.upsertArt({
        chapterNumber: 10 + idx,
        anchor: null,
        fileBuffer: Buffer.from(mimeType),
        mimeType,
        updatedBy: null,
      })
      if (art.filename !== expected) throw new Error(`expected ${expected}, got ${art.filename}`)
      await store.deleteArt(art.id)
    })
  }

  await check('reject unsupported MIME type', async () => {
    try {
      await store.upsertArt({
        chapterNumber: 1,
        anchor: null,
        fileBuffer: Buffer.from('x'),
        mimeType: 'image/svg+xml' as ArtMimeType,
        updatedBy: null,
      })
      throw new Error('expected rejection')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.includes('Unsupported MIME')) throw new Error(`wrong error: ${message}`)
    }
  })

  await check('filePathFor rejects tampered registry filenames', () => {
    try {
      store.filePathFor({ ...replacedBeat, filename: '../escape.png' })
      throw new Error('expected rejection')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.includes('invalid characters')) throw new Error(`wrong error: ${message}`)
    }
  })

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 3 })
      break
    } catch (err: unknown) {
      if (attempt === 2) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn(`  cleanup note: could not remove temp dir: ${message}`)
      } else {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }

  console.log(`\n[verify-art-store] ${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}`)
  process.exit(failed === 0 ? 0 : 1)
}

run().catch((err: unknown) => {
  console.error('[verify-art-store] FATAL:', err)
  process.exit(1)
})