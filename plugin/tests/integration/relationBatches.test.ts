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
it.each([false, true])(
  'routes final member metadata queued between root renames (repeat %s)',
  async (repeat) => {
    const app = useVault([
      { path: 'Samples/A.md' },
      { path: 'Samples/member.md' },
      { path: 'Samples/unrelated.md' },
    ])
    configureAbele()
    const summary = new NoteRelations('Samples/A.md'),
      unrelated = new NoteRelations('Samples/unrelated.md')
    relations.push(summary, unrelated)
    app.emit('metadataCache', 'resolved')
    const other = vi.spyOn(unrelated as never, 'applyChanges' as never)
    const root = app.vault.getFileByPath('Samples/A.md')!,
      member = app.vault.getFileByPath('Samples/member.md')!
    await app.vault.rename(root, 'Samples/B.md')
    app.emit('vault', 'rename', root, 'Samples/A.md')
    app.setFrontmatter(member.path, { groups: ['[[B]]'] })
    app.metadataCache.resolvedLinks[member.path] = { 'Samples/B.md': 1 }
    app.emit('metadataCache', 'changed', member)
    await app.vault.rename(root, 'Samples/C.md')
    app.emit('vault', 'rename', root, 'Samples/B.md')
    app.setFrontmatter(member.path, { groups: ['[[C]]'] })
    app.metadataCache.resolvedLinks[member.path] = { 'Samples/C.md': 1 }
    if (repeat) for (let i = 0; i < 10; i++) app.emit('metadataCache', 'changed', member)
    app.emit('metadataCache', 'resolved')
    expect(summary.filePath).toBe('Samples/C.md')
    expect([...summary.notes.keys()]).toEqual([member.path])
    expect(other).not.toHaveBeenCalled()
  }
)

it('retains repeated rename origins and later deletes the final root exactly once', async () => {
  const app = useVault([{ path: 'Samples/A.md' }, { path: 'Samples/unrelated.md' }])
  configureAbele()
  const summary = new NoteRelations('Samples/A.md'),
    unrelated = new NoteRelations('Samples/unrelated.md')
  relations.push(summary, unrelated)
  app.emit('metadataCache', 'resolved')
  const other = vi.spyOn(unrelated as never, 'applyChanges' as never),
    cleanup = vi.spyOn(summary, 'cleanup')
  const root = app.vault.getFileByPath('Samples/A.md')!
  for (const [from, to] of [
    ['A', 'B'],
    ['B', 'A'],
    ['A', 'B'],
  ]) {
    await app.vault.rename(root, `Samples/${to}.md`)
    app.emit('vault', 'rename', root, `Samples/${from}.md`)
  }
  app.emit('metadataCache', 'resolved')
  expect(summary.filePath).toBe('Samples/B.md')
  await app.vault.delete(root)
  app.emit('vault', 'delete', root)
  app.emit('metadataCache', 'resolved')
  expect(cleanup).toHaveBeenCalledOnce()
  expect(other).not.toHaveBeenCalled()
})

it('does not follow or clean a different root when paths are reused within a batch', async () => {
  const app = useVault([
    { path: 'Samples/A.md' },
    { path: 'Samples/B.md' },
    { path: 'Samples/unrelated.md' },
  ])
  configureAbele()
  const first = new NoteRelations('Samples/A.md'),
    second = new NoteRelations('Samples/B.md'),
    unrelated = new NoteRelations('Samples/unrelated.md')
  relations.push(first, second, unrelated)
  app.emit('metadataCache', 'resolved')
  const other = vi.spyOn(unrelated as never, 'applyChanges' as never)
  const firstCleanup = vi.spyOn(first, 'cleanup'),
    secondCleanup = vi.spyOn(second, 'cleanup')
  const a = app.vault.getFileByPath('Samples/A.md')!,
    b = app.vault.getFileByPath('Samples/B.md')!
  await app.vault.rename(a, 'Samples/temp.md')
  app.emit('vault', 'rename', a, 'Samples/A.md')
  await app.vault.rename(b, 'Samples/A.md')
  app.emit('vault', 'rename', b, 'Samples/B.md')
  await app.vault.rename(a, 'Samples/B.md')
  app.emit('vault', 'rename', a, 'Samples/temp.md')
  app.emit('metadataCache', 'resolved')
  expect(first.filePath).toBe('Samples/B.md')
  expect(second.filePath).toBe('Samples/A.md')
  const secondChanges = vi.spyOn(second as never, 'applyChanges' as never)
  await app.vault.delete(a)
  app.emit('vault', 'delete', a)
  app.emit('metadataCache', 'resolved')
  expect(firstCleanup).toHaveBeenCalledOnce()
  expect(secondCleanup).not.toHaveBeenCalled()
  expect(secondChanges).not.toHaveBeenCalled()
  expect(other).not.toHaveBeenCalled()
})

it('does not move a newly opened root at a vacated path along an earlier identity', async () => {
  const app = useVault([{ path: 'Samples/A.md' }])
  configureAbele()
  const original = new NoteRelations('Samples/A.md')
  relations.push(original)
  app.emit('metadataCache', 'resolved')
  const old = app.vault.getFileByPath('Samples/A.md')!
  await app.vault.rename(old, 'Samples/B.md')
  app.emit('vault', 'rename', old, 'Samples/A.md')
  const fresh = await app.vault.create('Samples/A.md', 'Fresh sample root')
  app.setFrontmatter(fresh.path, {})
  const replacement = new NoteRelations(fresh.path)
  relations.push(replacement)
  const cleanup = vi.spyOn(replacement, 'cleanup')
  await app.vault.rename(old, 'Samples/C.md')
  app.emit('vault', 'rename', old, 'Samples/B.md')
  app.emit('metadataCache', 'resolved')
  expect(original.filePath).toBe('Samples/C.md')
  expect(replacement.filePath).toBe('Samples/A.md')
  await app.vault.delete(old)
  app.emit('vault', 'delete', old)
  app.emit('metadataCache', 'resolved')
  expect(cleanup).not.toHaveBeenCalled()
})

it('carries a folder rename chain and an interleaved member through final link metadata', async () => {
  const app = useVault([
    { path: 'First/root.md' },
    { path: 'Outside/member.md' },
    { path: 'Outside/unrelated.md' },
  ])
  configureAbele()
  const summary = new NoteRelations('First/root.md'),
    unrelated = new NoteRelations('Outside/unrelated.md')
  relations.push(summary, unrelated)
  app.emit('metadataCache', 'resolved')
  const other = vi.spyOn(unrelated as never, 'applyChanges' as never)
  const folder = app.vault.getAbstractFileByPath('First')!,
    member = app.vault.getFileByPath('Outside/member.md')!
  await app.vault.rename(folder, 'Second')
  app.emit('vault', 'rename', folder, 'First')
  app.setFrontmatter(member.path, { groups: ['[[Second/root]]'] })
  app.metadataCache.resolvedLinks[member.path] = { 'Second/root.md': 1 }
  app.emit('metadataCache', 'changed', member)
  await app.vault.rename(folder, 'Third')
  app.emit('vault', 'rename', folder, 'Second')
  app.setFrontmatter(member.path, { groups: ['[[Third/root]]'] })
  app.metadataCache.resolvedLinks[member.path] = { 'Third/root.md': 1 }
  app.emit('metadataCache', 'resolved')
  expect(summary.filePath).toBe('Third/root.md')
  expect([...summary.notes.keys()]).toEqual([member.path])
  expect(other).not.toHaveBeenCalled()
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
