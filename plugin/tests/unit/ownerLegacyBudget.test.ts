// @vitest-environment node
import { it, expect } from 'vitest'
import { sha256 } from '@abele/sync-core'
import { PublicationIntents } from '@/sync/publication/publicationIntents'
import { publicationFixture } from '../helpers/publicationFixture'
it('migrates valid legacy prepared evidence at the old ledger limit without growing or raising that limit', async () => {
  const input = await publicationFixture(),
    unit = {
      requestId: 'sample',
      ops: [{ op: 'create' as const, path: 'sample.bin', sha: 'a'.repeat(64), size: 1, mtime: 1 }],
      createHandles: { 0: 'sample:0' },
    },
    hash = (v: unknown) => sha256(new TextEncoder().encode(JSON.stringify(v))),
    ledger = {
      version: 1,
      binding: input.binding,
      units: [{ unit, sha: await hash(unit), intents: [], holds: [''], settled: false }],
    },
    envelope = { ledger, checksum: 'a'.repeat(64) }
  ledger.units[0].holds[0] = 'x'.repeat(1024 * 1024 - JSON.stringify(envelope).length - 1)
  envelope.checksum = await hash(ledger)
  let raw: string | null = JSON.stringify(envelope)
  const originalLength = raw.length
  expect(originalLength).toBe(1024 * 1024 - 1)
  const manager = new PublicationIntents(
    {
      getMeta: () => raw,
      setMeta: (_key, value) => {
        raw = value
      },
    },
    input.binding,
    {} as any,
    () => true,
    () => true
  )
  await manager.bindSubmitted(unit)
  expect(raw!.length).toBeLessThan(originalLength)
  expect(raw!.length).toBeLessThan(1024 * 1024)
  await manager.bindSubmitted(unit)
  const decoded = await (manager as any).read()
  expect(decoded.units[0].unit).toEqual(unit)
  expect(decoded.units[0].submission.prepared).toEqual(unit)
  expect(decoded.units[0].holds[0]).toEqual(ledger.units[0].holds[0])
})
