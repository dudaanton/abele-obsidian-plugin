import { describe, expect, it } from 'vitest'
import {
  inspectProjection,
  parseProjection,
  projectionPath,
  recognizeProjection,
  serializeProjection,
  validateProjectionPlacement,
} from '@/sync/external/projection'

const projection = {
  format: 'abele.external',
  schema: 1,
  vaultId: 'sample-vault',
  fileId: 'sample-file',
  path: 'Media/sample-image.jpg',
  observedVersionId: 'sample-version',
  sha256: 'a'.repeat(64),
  size: 123456,
  mime: 'image/jpeg',
  mtime: 1790000000000,
}
const path = `${projection.path}.abele-ref`
const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
const owned = { fileId: projection.fileId, projectionPath: path, projectionSha: 'b'.repeat(64) }

describe('external projection schema and local ownership', () => {
  it('does not recognize an ordinary document merely quoting a projection example', () => {
    const guide = new TextEncoder().encode(
      'Sample format:\n```json\n' + JSON.stringify(projection) + '\n```'
    )
    expect(recognizeProjection(guide)).toBe(false)
    expect(
      inspectProjection(guide, 'Docs/sample-guide.md', { vaultId: projection.vaultId, owned: [] })
    ).toEqual({ kind: 'ordinary' })
  })
  it('round trips schema 1 with bounded optional media metadata and MIME fallback', () => {
    const value = { ...projection, width: 800, height: 600, duration: 1.5 }
    expect(parseProjection(serializeProjection(value))).toEqual(value)
    expect(parseProjection(bytes({ ...projection, mime: 'unknown/type' })).mime).toBe(
      'application/octet-stream'
    )
  })

  it('keeps marker recognition separate from schema validation and extension', () => {
    expect(recognizeProjection(bytes(projection))).toBe(true)
    expect(
      recognizeProjection(new TextEncoder().encode('{"format":"abele.external", broken'))
    ).toBe(true)
    expect(() => parseProjection(bytes({ ...projection, schema: 2 }))).toThrow()
    expect(
      inspectProjection(bytes(projection), 'Media/renamed.txt', {
        vaultId: projection.vaultId,
        owned: [owned],
        sha: owned.projectionSha,
      })
    ).toMatchObject({ kind: 'hold', reason: 'moved' })
    expect(
      inspectProjection(bytes({ format: 'ordinary' }), path, {
        vaultId: projection.vaultId,
        owned: [],
      })
    ).toEqual({ kind: 'ordinary' })
  })

  it('holds foreign and recognizable unowned projections without adopting identity', () => {
    expect(
      inspectProjection(bytes({ ...projection, vaultId: 'other-vault' }), path, {
        vaultId: projection.vaultId,
        owned: [owned],
        sha: owned.projectionSha,
      })
    ).toMatchObject({ kind: 'hold', reason: 'foreign' })
    expect(
      inspectProjection(bytes(projection), path, { vaultId: projection.vaultId, owned: [] })
    ).toMatchObject({ kind: 'hold', reason: 'unowned' })
    expect(
      inspectProjection(bytes({ ...projection, fileId: 'other-file' }), path, {
        vaultId: projection.vaultId,
        owned: [owned],
        sha: owned.projectionSha,
      })
    ).toMatchObject({ kind: 'hold', reason: 'foreign' })
  })

  it('protects known paths even when the JSON or marker is destroyed; changed bytes never become ordinary', () => {
    expect(
      inspectProjection(new TextEncoder().encode('damaged'), path, {
        vaultId: projection.vaultId,
        owned: [owned],
      })
    ).toMatchObject({ kind: 'hold', reason: 'malformed' })
    expect(
      inspectProjection(bytes(projection), path, {
        vaultId: projection.vaultId,
        owned: [owned],
        sha: 'c'.repeat(64),
      })
    ).toMatchObject({ kind: 'hold', reason: 'changed' })
    expect(
      inspectProjection(bytes(projection), path, {
        vaultId: projection.vaultId,
        owned: [owned],
        sha: owned.projectionSha,
      })
    ).toMatchObject({ kind: 'owned' })
  })

  it('rejects credentials, URLs, preferences, recovery paths and invalid protocol values', () => {
    for (const extra of [
      { token: 'sample-secret' },
      { url: 'https://files.example.invalid/download' },
      { pinned: true },
      { retainedPath: 'Recovery/sample.bin' },
    ])
      expect(() => parseProjection(bytes({ ...projection, ...extra }))).toThrow()
    for (const change of [
      { path: '../sample.jpg' },
      { path: '/Media/sample.jpg' },
      { sha256: 'A'.repeat(64) },
      { size: -1 },
      { size: 200 * 1024 * 1024 + 1 },
      { duration: -1 },
      { width: 0 },
      { mtime: Infinity },
    ])
      expect(() => parseProjection(bytes({ ...projection, ...change }))).toThrow()
  })

  it('holds overlong UTF-8 projections and sidecar names, without inventing another name', () => {
    const long = new TextEncoder().encode(JSON.stringify(projection) + ' '.repeat(16 * 1024))
    expect(() => parseProjection(long)).toThrow()
    expect(inspectProjection(long, path, { vaultId: projection.vaultId, owned: [] })).toMatchObject(
      { kind: 'hold', reason: 'malformed' }
    )
    const lateMarker = new TextEncoder().encode(' '.repeat(16 * 1024) + JSON.stringify(projection))
    expect(
      inspectProjection(lateMarker, 'Media/moved.txt', { vaultId: projection.vaultId, owned: [] })
    ).toMatchObject({ kind: 'hold', reason: 'malformed' })
    expect(() => projectionPath('Media/' + 'x'.repeat(250))).toThrow()
    expect(() => projectionPath('Media/' + 'é'.repeat(124))).toThrow()
    expect(() => projectionPath('Media/' + 'e\u0301'.repeat(90))).toThrow()
  })

  it('normalizes wire paths to NFC but retains physical spelling; case/Unicode collisions block', () => {
    const physical = 'Media/cafe\u0301.jpg'
    expect(parseProjection(bytes({ ...projection, path: physical })).path).toBe('Media/café.jpg')
    expect(projectionPath(physical)).toBe(`${physical}.abele-ref`)
    expect(
      validateProjectionPlacement(
        { ...projection, path: 'Media/café.jpg' },
        `${physical}.abele-ref`
      )
    ).toBe(true)
    expect(() => projectionPath(projection.path, ['media/SAMPLE-image.jpg.abele-ref'])).toThrow(
      /collision/
    )
    expect(() => projectionPath(physical, ['Media/café.jpg.abele-ref'])).toThrow(/collision/)
    expect(() => projectionPath(physical, ['Media/café.jpg'])).toThrow(/collision/)
    expect(validateProjectionPlacement(projection, 'Media/other.jpg.abele-ref')).toBe(false)
  })
})
