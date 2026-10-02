import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { ChangeTracker, MAX_BLOB_BYTES } from '@/ai/rewind/ChangeTracker'
import { ChatRewind } from '@/ai/rewind/ChatRewind'
import { memoryStore } from '@/ai/rewind/RewindStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { writeWordChange } from '@/word/vaultAdapter'
import { sampleDocx, paragraph } from '../fixtures/docx/sampleDocx'
import { useVault } from '../helpers/testEnv'

let tracker: ChangeTracker | null = null
beforeEach(() => {
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, rewindLimitMb: 100 }
})
afterEach(() => {
  tracker?.uninstall()
  tracker = null
  vi.restoreAllMocks()
})

describe('Word prepared bytes in agent rewind', () => {
  it('keeps the prepared version even if a snapshot read would see a different version', async () => {
    const fake = useVault([])
    const app = fake as unknown as App
    const original = sampleDocx(paragraph('Original sample'))
    const edited = sampleDocx(paragraph('Edited sample'))
    const competing = sampleDocx(paragraph('Competing sample'))
    const file = await app.vault.createBinary('sample.docx', original.buffer as ArrayBuffer)
    const rawModify = app.vault.modifyBinary.bind(app.vault)
    const rawRead = app.vault.readBinary.bind(app.vault)
    let written = false
    let reads = 0
    vi.spyOn(app.vault, 'modifyBinary').mockImplementation(async (target, bytes) => {
      written = true
      await rawModify(target, bytes)
    })
    vi.spyOn(app.vault, 'readBinary').mockImplementation(async (target) => {
      // A normal tracker snapshot after the final check would see this intervening version.
      if (target.path === file.path && !written && ++reads > 1)
        await rawModify(target, competing.buffer as ArrayBuffer)
      return rawRead(target)
    })
    tracker = ChangeTracker.install(app)
    const store = memoryStore()
    const log = new ChatRewind(app, { key: () => 'sample-chat', turn: () => 'sample-turn' }, store)
    const close = log.begin('docx_edit')
    try {
      await writeWordChange(app, file, original, edited)
    } finally {
      await close()
    }
    expect(reads).toBe(1)
    expect(log.entries.value).toHaveLength(1)
    const before = log.entries.value[0].changes[0].before
    expect(before.t).toBe('binary')
    if (before.t !== 'binary' || !before.blob)
      throw new Error('Original Word bytes were not retained')
    expect(new Uint8Array((await store.readBlob('sample-chat', before.blob))!)).toEqual(original)
    const plan = await log.planTurn('sample-turn')
    expect((await log.apply(plan, {})).restored).toEqual(['sample.docx'])
    expect(new Uint8Array(await rawRead(file))).toEqual(original)
  })
  it('retains the prepared bytes when read-back detects a competing save', async () => {
    const fake = useVault([])
    const app = fake as unknown as App
    const original = sampleDocx(paragraph('Original sample'))
    const edited = sampleDocx(paragraph('Edited sample'))
    const competing = sampleDocx(paragraph('Competing sample'))
    const file = await app.vault.createBinary('sample.docx', original.buffer as ArrayBuffer)
    const rawModify = app.vault.modifyBinary.bind(app.vault)
    vi.spyOn(app.vault, 'modifyBinary').mockImplementation(async (target, bytes) => {
      await rawModify(target, bytes)
      await rawModify(target, competing.buffer as ArrayBuffer)
    })
    tracker = ChangeTracker.install(app)
    const store = memoryStore()
    const log = new ChatRewind(app, { key: () => 'sample-chat', turn: () => 'sample-turn' }, store)
    const close = log.begin('docx_edit')
    try {
      await expect(writeWordChange(app, file, original, edited)).rejects.toThrow(
        /changed while saving.*reopen/i
      )
    } finally {
      await close()
    }
    expect(new Uint8Array(await app.vault.readBinary(file))).toEqual(competing)
    const before = log.entries.value[0].changes[0].before
    if (before.t !== 'binary' || !before.blob)
      throw new Error('Original Word bytes were not retained')
    expect(new Uint8Array((await store.readBlob('sample-chat', before.blob))!)).toEqual(original)
  })

  it('retains explicitly prepared binaries above the generic snapshot cap', async () => {
    const fake = useVault([])
    const app = fake as unknown as App
    const original = new Uint8Array(MAX_BLOB_BYTES + 1).fill(1)
    const file = await app.vault.createBinary('sample.docx', original.buffer)
    tracker = ChangeTracker.install(app)
    const store = memoryStore()
    const log = new ChatRewind(app, { key: () => 'sample-chat', turn: () => 'sample-turn' }, store)
    const close = log.begin('docx_edit')
    try {
      const run = tracker.prepareBinaryWrite(file.path, original, () => true)
      await run(() => app.vault.modifyBinary(file, Uint8Array.from([2]).buffer))
    } finally {
      await close()
    }
    const before = log.entries.value[0].changes[0].before
    if (before.t !== 'binary' || !before.blob)
      throw new Error('Large prepared Word bytes were not retained')
    const kept = await store.readBlob('sample-chat', before.blob)
    expect(kept?.byteLength).toBe(original.length)
    expect(new Uint8Array(kept!)[0]).toBe(1)
    expect(new Uint8Array(kept!)[original.length - 1]).toBe(1)
  })
})
