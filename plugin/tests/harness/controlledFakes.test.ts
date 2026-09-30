import { expect, it } from 'vitest'
import { buildFakeVault } from '../helpers/fakeVault'
import { FakeSettings } from '../helpers/fakeSettings'

it('can hold frontmatter persistence and metadata delivery independently', async () => {
  const app = buildFakeVault([{ path: 'sample-note.md', frontmatter: { title: 'Before' } }])
  const file = app.vault.getFileByPath('sample-note.md')!
  const write = app.delays.holdNext('frontmatter')
  const metadata = app.delays.holdNext('metadata')
  const saving = app.fileManager.processFrontMatter(file, (fm) => { fm.title = 'After' })
  await write.entered
  expect(await app.vault.read(file)).toContain('Before')
  write.release()
  await saving
  await metadata.entered
  expect(await app.vault.read(file)).toContain('After')
  expect(app.metadataCache.getFileCache(file)?.frontmatter?.title).toBe('Before')
  metadata.release()
  await Promise.resolve()
  expect(app.metadataCache.getFileCache(file)?.frontmatter?.title).toBe('After')
})

it('can fail a held write without changing the note', async () => {
  const app = buildFakeVault([{ path: 'sample-note.md', content: 'Before' }])
  const file = app.vault.getFileByPath('sample-note.md')!
  const write = app.delays.holdNext('frontmatter')
  const saving = app.fileManager.processFrontMatter(file, (fm) => { fm.title = 'After' })
  const rejected = expect(saving).rejects.toThrow('disk unavailable')
  await write.entered
  write.reject(new Error('disk unavailable'))
  await rejected
  expect(await app.vault.read(file)).toBe('Before')
})

it('holds settings saves by value and loads independently', async () => {
  const settings = new FakeSettings({ title: 'Before' })
  const gate = settings.delays.holdNext('save')
  const data = { title: 'After' }
  const saving = settings.saveData(data)
  await gate.entered
  data.title = 'Later'
  expect(await settings.loadData()).toEqual({ title: 'Before' })
  gate.release()
  await saving
  expect(await settings.loadData()).toEqual({ title: 'After' })
  const read = settings.delays.holdNext('load')
  const loading = settings.loadData()
  const rejected = expect(loading).rejects.toThrow('read unavailable')
  await read.entered
  read.reject(new Error('read unavailable'))
  await rejected
})
