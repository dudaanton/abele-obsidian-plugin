import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { renameSelectValueInNotes } from '@/properties/selectRename'

function vault(fronts: Record<string, unknown>[], failAt = -1) {
  const files = fronts.map((_, index) => ({ path: `Sample ${index}.md`, index }))
  const processFrontMatter = vi.fn(
    async (file: (typeof files)[number], change: (front: Record<string, unknown>) => void) => {
      if (file.index === failAt) throw new Error('write failed')
      change(fronts[file.index])
    }
  )
  const app = {
    vault: { getMarkdownFiles: () => files },
    // Deliberately stale: the value and even the key can have changed since caching.
    metadataCache: { getFileCache: () => ({ frontmatter: { stage: 'Ready' } }) },
    fileManager: { processFrontMatter },
  } as unknown as App
  return { app, processFrontMatter }
}

it('rechecks current frontmatter and never replaces a different scalar from stale cache', async () => {
  const fronts = [{ stage: 'Waiting' }, { Stage: ' READY ' }, { other: 'Ready' }]
  const { app } = vault(fronts)
  await renameSelectValueInNotes(app, 'stage', 'Ready', 'Complete')
  expect(fronts).toEqual([{ stage: 'Waiting' }, { Stage: 'Complete' }, { other: 'Ready' }])
})

it('preserves unrelated list values, types, whitespace and metadata', async () => {
  const fronts = [{ stage: ['Ready', 4, '  Legacy  ', false, { value: 'Ready' }], other: 'Ready' }]
  await renameSelectValueInNotes(vault(fronts).app, ' Stage ', 'Ready', 'Complete')
  expect(fronts).toEqual([
    { stage: ['Complete', 4, '  Legacy  ', false, { value: 'Ready' }], other: 'Ready' },
  ])
})

it('awaits writes and reports a failure instead of launching unobserved writes', async () => {
  const fronts = [{ stage: 'Ready' }, { stage: 'Ready' }, { stage: 'Ready' }]
  const { app, processFrontMatter } = vault(fronts, 1)
  await expect(renameSelectValueInNotes(app, 'stage', 'Ready', 'Complete')).rejects.toThrow(
    'write failed'
  )
  expect(processFrontMatter).toHaveBeenCalledTimes(2)
  expect(fronts[2].stage).toBe('Ready')
})
