import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteRelations } from '@/entities/NoteRelations'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { useVault, configureAbele } from '../helpers/testEnv'

const relations: NoteRelations[] = []
afterEach(() => {
  for (const r of relations.splice(0)) r.cleanup()
  VaultWatcherWrapper.destroy()
  vi.restoreAllMocks()
})
it('routes a complete two-rename chain to its original summary after initial resolution', async () => {
  const app = useVault([{ path: 'Samples/A.md' }, { path: 'Samples/unrelated.md' }])
  configureAbele()
  const summary = new NoteRelations('Samples/A.md'),
    unrelated = new NoteRelations('Samples/unrelated.md')
  relations.push(summary, unrelated)
  app.emit('metadataCache', 'resolved')
  const other = vi.spyOn(unrelated as never, 'applyChanges' as never)
  const file = app.vault.getFileByPath('Samples/A.md')!
  await app.vault.rename(file, 'Samples/B.md')
  app.emit('vault', 'rename', file, 'Samples/A.md')
  await app.vault.rename(file, 'Samples/C.md')
  app.emit('vault', 'rename', file, 'Samples/B.md')
  app.emit('metadataCache', 'resolved')
  expect(summary.filePath).toBe('Samples/C.md')
  expect(other).not.toHaveBeenCalled()
  const member = await app.vault.create(
    'Samples/member.md',
    '---\ngroups:\n  - "[[C]]"\n---\nSample member'
  )
  app.setFrontmatter(member.path, { groups: ['[[C]]'] })
  app.metadataCache.resolvedLinks[member.path] = { 'Samples/C.md': 1 }
  app.emit('metadataCache', 'changed', member)
  app.emit('metadataCache', 'resolved')
  expect([...summary.notes.keys()]).toEqual([member.path])
})

it('routes a delete at the renamed identity and retires the original summary', async () => {
  const app = useVault([{ path: 'Samples/A.md' }])
  configureAbele()
  const summary = new NoteRelations('Samples/A.md')
  relations.push(summary)
  app.emit('metadataCache', 'resolved')
  const cleanup = vi.spyOn(summary, 'cleanup')
  const file = app.vault.getFileByPath('Samples/A.md')!
  await app.vault.rename(file, 'Samples/B.md')
  app.emit('vault', 'rename', file, 'Samples/A.md')
  await app.vault.delete(file)
  app.emit('vault', 'delete', file)
  app.emit('metadataCache', 'resolved')
  expect(cleanup).toHaveBeenCalledOnce()
  const replacement = await app.vault.create('Samples/B.md', 'Replacement sample')
  app.emit('metadataCache', 'changed', replacement)
  app.emit('metadataCache', 'resolved')
  expect(summary.notes.size).toBe(0)
  expect(cleanup).toHaveBeenCalledOnce()
})

it('moves a tracked group and its members on a folder-only rename and cleans them on folder deletion', async () => {
  const app = useVault([
    { path: 'Samples/root.md' },
    { path: 'Samples/child.md', frontmatter: { groups: ['[[root]]'] }, content: 'Sample child' },
  ])
  configureAbele()
  const summary = new NoteRelations('Samples/root.md')
  relations.push(summary)
  app.emit('metadataCache', 'resolved')
  expect([...summary.notes.keys()]).toEqual(['Samples/child.md'])
  const folder = app.vault.getAbstractFileByPath('Samples')!
  await app.vault.rename(folder, 'Renamed samples')
  app.emit('vault', 'rename', folder, 'Samples')
  app.emit('metadataCache', 'resolved')
  expect(summary.filePath).toBe('Renamed samples/root.md')
  expect([...summary.notes.keys()]).toEqual(['Renamed samples/child.md'])
  await app.vault.delete(folder)
  app.emit('vault', 'delete', folder)
  app.emit('metadataCache', 'resolved')
  expect(summary.notes.size).toBe(0)
})

it('coalesces one note and routes only summaries reached by its links', () => {
  const app = useVault([
    { path: 'Samples/one.md' },
    { path: 'Samples/two.md' },
    { path: 'Samples/child.md', frontmatter: { type: 'note' }, content: '[[Samples/one]]' },
    { path: 'Samples/unrelated.md' },
  ])
  configureAbele()
  const one = new NoteRelations('Samples/one.md'),
    two = new NoteRelations('Samples/two.md')
  relations.push(one, two)
  app.emit('metadataCache', 'resolved')
  expect([...one.notes.keys()]).toEqual(['Samples/child.md'])
  const oneCheck = vi.spyOn(one as never, 'isRelatedPath' as never)
  const twoCheck = vi.spyOn(two as never, 'isRelatedPath' as never)
  const child = app.vault.getFileByPath('Samples/child.md')!
  for (let i = 0; i < 100; i++) app.emit('metadataCache', 'changed', child)
  app.emit('metadataCache', 'resolved')
  expect(oneCheck.mock.calls.length).toBeLessThan(5)
  expect(twoCheck).not.toHaveBeenCalled()
  oneCheck.mockClear()
  const unrelated = app.vault.getFileByPath('Samples/unrelated.md')!
  app.emit('vault', 'delete', unrelated)
  app.emit('metadataCache', 'resolved')
  expect(oneCheck).not.toHaveBeenCalled()
  expect(twoCheck).not.toHaveBeenCalled()
})
