import { expect, it } from 'vitest'
import { MemoryStateStore } from '@abele/sync-sdk/core'
import { AttachmentConsent } from '@/sync/attachmentConsent'

const source = {
  id: 'connection-a',
  address: 'https://sync.example',
  spaceId: 'space-a',
  tokenId: 'token-a',
  scope: { kind: 'group' as const, id: 'group-a', path: 'Groups/sample.md' },
}
const target = { id: 'local-file-a', path: 'Private/sample.png', kind: 'attachment' as const }
const resolve = async (id: string) => (id === target.id ? target : null)
it('never grants consent on arrival or indexing; only an explicit note-open creates a question', async () => {
  const store = new MemoryStateStore(),
    consent = new AttachmentConsent(store)
  await consent.observeNote(source, 'local-note-a', [target.id])
  await consent.observeNote({ ...source, id: 'connection-b' }, 'local-note-a', [target.id])
  expect(await consent.pending()).toEqual([])
  expect(await consent.mayUpload(source, target)).toBe(false)
  const questions = await consent.noteOpened(source, 'local-note-a', { resolve })
  expect(questions).toHaveLength(1)
  expect(questions[0]).toMatchObject({ source, fileId: target.id, path: target.path })
  expect(await consent.mayUpload(source, target)).toBe(false)
  await consent.decide(questions[0].id, true, { resolve })
  expect(
    await new AttachmentConsent(store).mayUpload(source, { ...target, path: 'Private/renamed.png' })
  ).toBe(true)
  expect(await consent.mayUpload({ ...source, id: 'connection-b' }, target)).toBe(false)
  expect(
    await consent.noteOpened({ ...source, id: 'connection-b' }, 'local-note-a', { resolve })
  ).toHaveLength(1)
})
it('receives automatically only through its own connection and persists a refusal without stopping other files', async () => {
  const store = new MemoryStateStore(),
    consent = new AttachmentConsent(store)
  await consent.recordReceived({ ...source, id: 'connection-b' }, target.id)
  await consent.observeNote(source, 'local-note-a', [target.id])
  const questions = await consent.noteOpened(source, 'local-note-a', { resolve })
  await consent.decide(questions[0].id, false, { resolve })
  const restarted = new AttachmentConsent(store)
  expect(await restarted.noteOpened(source, 'local-note-a', { resolve })).toEqual([])
  expect(await restarted.mayUpload(source, target)).toBe(false)
  expect(await restarted.mayUpload({ ...source, id: 'connection-b' }, target)).toBe(true)
  expect(await restarted.mayUpload(source, { ...target, id: 'replacement-at-same-path' })).toBe(
    false
  )
})
it('revalidates identity and current links before approval and never asks from Canvas or config', async () => {
  const consent = new AttachmentConsent(new MemoryStateStore())
  await consent.observeNote(source, 'canvas-a', [target.id], 'canvas')
  expect(await consent.noteOpened(source, 'canvas-a', { resolve })).toEqual([])
  await consent.observeNote(source, 'local-note-a', [target.id])
  const [question] = await consent.noteOpened(source, 'local-note-a', { resolve })
  expect(
    await consent.decide(question.id, true, {
      resolve: async () => ({ ...target, id: 'replacement' }),
    })
  ).toBe(false)
  await consent.observeNote(source, 'local-note-a', [])
  expect(await consent.decide(question.id, true, { resolve })).toBe(false)
  expect(
    await consent.mayUpload(source, { ...target, path: '.obsidian/plugins/sample/main.js' })
  ).toBe(false)
  await expect(
    consent.mayUpload({ ...source, scope: { kind: 'folder', id: 'root', path: '/' } }, target)
  ).rejects.toThrow('binding changed')
  expect(
    await consent.mayUpload(
      { ...source, id: 'connection-root', scope: { kind: 'folder', id: 'root', path: '/' } },
      target
    )
  ).toBe(true)
})
it('requires an actual folder boundary and excludes custom config roots regardless of received provenance', async () => {
  const consent = new AttachmentConsent(new MemoryStateStore(), { configRoots: ['.vault-config'] })
  const folder = {
    ...source,
    id: 'folder-connection',
    scope: { kind: 'folder' as const, id: 'folder-a', path: 'Shared' },
  }
  expect(await consent.mayUpload(folder, target)).toBe(false)
  expect(await consent.mayUpload(folder, { ...target, path: 'Shared/sample.png' })).toBe(true)
  await consent.recordReceived(source, target.id)
  expect(
    await consent.mayUpload(source, { ...target, path: '.vault-config/plugins/sample/main.js' })
  ).toBe(false)
  expect(await consent.state()).toMatchObject({ decisions: [], questions: [] })
})
