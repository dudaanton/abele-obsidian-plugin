import { expect, it, vi } from 'vitest'
import { ExternalFileActions, matchesRule } from '@/sync/external/fileActions'

it('previews without effects and rechecks confirmed versions', async () => {
  const evict = vi.fn(async () => ({ status: 'complete', reclaimedBytes: 20 }))
  let changed = false
  const actions = new ExternalFileActions({
    inspect: async (path) => ({
      path,
      size: 20,
      version: changed ? 'new' : 'old',
      pinned: false,
      blocked: null,
    }),
    evict,
  })
  const preview = await actions.preview(['sample.bin', 'sample.bin'])
  expect(preview.bytes).toBe(20)
  expect(evict).not.toHaveBeenCalled()
  changed = true
  expect((await actions.apply(preview))[0].status).toBe('version-changed')
  expect(evict).not.toHaveBeenCalled()
})
it('excludes pinned, open and changed files from the estimate', async () => {
  const actions = new ExternalFileActions({
    inspect: async (path) => ({
      path,
      size: 20,
      version: 'v',
      pinned: path === 'pinned',
      blocked: path === 'open' ? 'busy' : path === 'changed' ? 'local-changed' : null,
    }),
    evict: vi.fn(),
  })
  const preview = await actions.preview(['pinned', 'open', 'changed', 'sample.bin'])
  expect(preview.bytes).toBe(20)
  expect(preview.files).toHaveLength(1)
  expect(preview.skipped).toHaveLength(3)
})
it('combines folder, extension, size and known last-opened age', () => {
  const rule = { folder: 'Archive', extensions: ['pdf'], minBytes: 100, unopenedDays: 7 }
  const file = { path: 'Archive/sample.pdf', size: 100, lastOpened: 1 }
  expect(matchesRule(rule, file, 8 * 86400000)).toBe(true)
  expect(matchesRule(rule, { ...file, path: 'Archive-other/sample.pdf' }, 8 * 86400000)).toBe(false)
  expect(matchesRule(rule, { ...file, lastOpened: undefined }, 8 * 86400000)).toBe(false)
})
