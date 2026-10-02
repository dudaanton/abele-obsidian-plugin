import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { ChangeTracker, MAX_BLOB_BYTES } from '@/ai/rewind/ChangeTracker'
import { ChatRewind } from '@/ai/rewind/ChatRewind'
import { memoryStore } from '@/ai/rewind/RewindStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { openXlsx } from '@/spreadsheet/package'
import { applyWorkbookEdit } from '@/spreadsheet/edit'
import { writeWorkbookChange } from '@/spreadsheet/vaultAdapter'
import { sameBytes } from '@/ooxml/write'
import { sampleParts, sampleXlsx } from '../fixtures/xlsx/sampleXlsx'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, rewindLimitMb: 100 }
})
afterEach(() => ChangeTracker.get()?.uninstall())
describe('workbook prepared originals in existing chat rewind', () => {
  it.each([false, true])(
    'restores the original workbook, including above the opportunistic blob cap: %s',
    async (large) => {
      const app = useVault([])
      const parts = sampleParts()
      if (large) parts['custom/sample-data.bin'] = new Uint8Array(MAX_BLOB_BYTES + 1).fill(42)
      const original = large ? zipSync(parts, { level: 0 }) : sampleXlsx()
      if (large) expect(original.length).toBeGreaterThan(MAX_BLOB_BYTES)
      const file = await app.vault.createBinary('sample.xlsx', original.buffer as ArrayBuffer)
      const updated = await applyWorkbookEdit(await openXlsx(original), {
        sheet: 'Sample',
        range: 'B2',
        values: [[25]],
      })
      ChangeTracker.install(app)
      const store = memoryStore()
      const log = new ChatRewind(
        app,
        { key: () => 'sample-chat', turn: () => 'sample-turn' },
        store
      )
      const close = log.begin('xlsx_write')
      try {
        await writeWorkbookChange(app, file, original, updated)
      } finally {
        await close()
      }
      expect(log.entries.value).toHaveLength(1)
      const before = log.entries.value[0].changes[0].before
      if (before.t !== 'binary' || !before.blob)
        throw Error('Prepared workbook bytes were not retained')
      const kept = await store.readBlob('sample-chat', before.blob)
      expect(kept?.byteLength).toBe(original.length)
      expect(sameBytes(new Uint8Array(kept!), original)).toBe(true)
      const plan = await log.planTurn('sample-turn')
      expect((await log.apply(plan, {})).restored).toEqual(['sample.xlsx'])
      expect(sameBytes(new Uint8Array(await app.vault.readBinary(file)), original)).toBe(true)
    },
    60000
  )
})
