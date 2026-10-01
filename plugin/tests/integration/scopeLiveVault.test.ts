import { afterEach, expect, it } from 'vitest'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { useVault } from '../helpers/testEnv'

const scopes: ScopeResolver[] = []
const scope = () => {
  const value = new ScopeResolver()
  scopes.push(value)
  return value
}
afterEach(() => {
  scopes.forEach((value) => value.destroy())
  scopes.length = 0
})

it('sees a new note in an allowed folder after the first access check', async () => {
  const app = useVault([{ path: 'Allowed/old.md' }])
  const access = scope()
  access.addFolder('Allowed')
  expect(access.getAccessiblePaths()).toEqual(['Allowed/old.md'])
  const file = await app.vault.create('Allowed/new.md', '')
  app.emit('vault', 'create', file)
  expect(access.isInScope('Allowed/new.md')).toBe(true)
})

it('drops deleted notes and picks up notes moved into a matching pattern', async () => {
  const app = useVault([{ path: 'Allowed/old.md' }, { path: 'Elsewhere/new.md' }])
  const access = scope()
  access.addPattern('Allowed/**')
  access.resolve()
  const old = app.vault.getAbstractFileByPath('Allowed/old.md')!
  await app.vault.delete(old)
  app.emit('vault', 'delete', old)
  const file = app.vault.getAbstractFileByPath('Elsewhere/new.md')!
  await app.vault.rename(file, 'Allowed/new.md')
  app.emit('vault', 'rename', file, 'Elsewhere/new.md')
  expect(access.getAccessiblePaths()).toEqual(['Allowed/new.md'])
})

it('updates group access when metadata changes', () => {
  const app = useVault([
    { path: 'Sample group.md' },
    { path: 'Child.md', frontmatter: { groups: ['[[Sample group]]'] } },
  ])
  const access = scope()
  access.addGroup('Sample group.md')
  expect(access.isInScope('Child.md')).toBe(true)
  app.setFrontmatter('Child.md', { groups: [] })
  app.emit('metadataCache', 'changed', app.vault.getAbstractFileByPath('Child.md'))
  expect(access.isInScope('Child.md')).toBe(false)
})
