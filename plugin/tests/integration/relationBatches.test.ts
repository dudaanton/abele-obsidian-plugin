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
