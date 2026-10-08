// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildFakeVault } from '../helpers/fakeVault'
import { moveAndRetain, probeAdapter } from './externalFileSafetyProbe'

const path = 'sample-original.bin'
const backup = 'sample-retained.bin'
const text = (value: string) => new TextEncoder().encode(value).buffer as ArrayBuffer

describe('external-file safety probes (test-only, not an eviction implementation)', () => {
  it('detects a save between hashing and moving and retains every byte', async () => {
    const {
      vault: { adapter },
    } = buildFakeVault([{ path, raw: 'sample base' }])
    const result = await moveAndRetain(adapter, path, backup, async () => {
      await adapter.writeBinary(path, text('sample edit'))
    })
    expect(result).toEqual({ state: 'local-changed', retained: true, sourceOccupied: false })
    expect(new TextDecoder().decode(await adapter.readBinary(backup))).toBe('sample edit')
  })

  it('never removes even a matching retained copy without a writer-exclusion contract', async () => {
    const {
      vault: { adapter },
    } = buildFakeVault([{ path, raw: 'sample base' }])
    expect(await moveAndRetain(adapter, path, backup)).toEqual({
      state: 'cleanup-pending',
      retained: true,
      sourceOccupied: false,
    })
    expect(new TextDecoder().decode(await adapter.readBinary(backup))).toBe('sample base')
  })

  it('preserves a new original beside the retained copy', async () => {
    const {
      vault: { adapter },
    } = buildFakeVault([{ path, raw: 'sample base' }])
    const result = await moveAndRetain(adapter, path, backup, undefined, async () => {
      await adapter.writeBinary(path, text('sample recreation'))
    })
    expect(result).toEqual({ state: 'source-occupied', retained: true, sourceOccupied: true })
    expect(new TextDecoder().decode(await adapter.readBinary(path))).toBe('sample recreation')
    expect(new TextDecoder().decode(await adapter.readBinary(backup))).toBe('sample base')
  })

  it('refuses an occupied retained-copy name rather than overwriting it', async () => {
    const {
      vault: { adapter },
    } = buildFakeVault([
      { path, raw: 'sample base' },
      { path: backup, raw: 'sample occupant' },
    ])
    await expect(moveAndRetain(adapter, path, backup)).rejects.toThrow()
    expect(new TextDecoder().decode(await adapter.readBinary(path))).toBe('sample base')
    expect(new TextDecoder().decode(await adapter.readBinary(backup))).toBe('sample occupant')
  })

  it('makes unsafe hash/remove and check/write interleavings executable', async () => {
    const {
      vault: { adapter },
    } = buildFakeVault([])
    await adapter.mkdir('sample-probe')
    const report = await probeAdapter(adapter, 'sample-probe')
    expect(report.hashRemove).toEqual({ checked: true, editLost: true })
    expect(report.cleanupRace).toEqual({ checked: true, editLost: true })
    expect(report.moveRace).toEqual({
      state: 'local-changed',
      retained: true,
      sourceOccupied: false,
    })
    expect(report.checkWrite).toEqual({ sawAbsent: true, occupantOverwritten: true })
    expect(report.renameOccupied.refused).toBe(true)
    expect(report.renameOccupied.target).toBe('sample occupant')
    expect(report.renameOccupied.source).toBe('sample incoming')
    expect(report.replaceGap).toEqual({
      targetAbsent: true,
      refused: true,
      original: 'sample base',
      incoming: 'sample incoming',
      occupant: 'sample occupant',
    })
  })
})
