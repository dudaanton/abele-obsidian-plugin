import { expect, it, vi } from 'vitest'
import { projectionEvidence, EXTERNAL_INSPECTION_KEY } from '@/sync/external/pluginSafety'
import { buildFakeVault } from '../helpers/fakeVault'

it('bounds total serialized inspection entries while keeping the complete restart cache', async () => {
  const count = 768
  const app = buildFakeVault(
    Array.from({ length: count }, (_, i) => ({
      path: `Notes/sample-${i}.md`,
      content: 'ordinary note',
    }))
  )
  const save = vi.spyOn(app, 'saveLocalStorage')
  await projectionEvidence(app as never)
  const checkpoints = save.mock.calls.filter(([key]) => key === EXTERNAL_INSPECTION_KEY)
  const entriesWritten = checkpoints.reduce(
    (sum, [, value]) => sum + (value as { entries: unknown[] }).entries.length,
    0
  )
  expect(
    (app.loadLocalStorage(EXTERNAL_INSPECTION_KEY) as { entries: unknown[] }).entries
  ).toHaveLength(count)
  expect(entriesWritten).toBeLessThanOrEqual(count * 3)
  save.mockClear()
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  await projectionEvidence(app as never)
  expect(read).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})
