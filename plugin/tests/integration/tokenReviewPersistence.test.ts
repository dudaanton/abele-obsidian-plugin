import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { sha256 } from '@abele/sync-sdk/core'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { openDeviceReviews } from '@/sync/openDeviceReviews'

it('automatically reconnects the review writer without losing pending operations', async () => {
  const factory = new IDBFactory()
  const open = factory.open.bind(factory)
  let database: IDBDatabase | undefined
  factory.open = (...args) => {
    const request = open(...args)
    request.addEventListener('success', () => {
      database = request.result
    })
    return request
  }
  const review = await openDeviceReviews(factory, 'reconnecting-vault')
  const source = {
    id: 'connection-a',
    address: 'https://sync.example',
    spaceId: 'space-a',
    tokenId: 'token-a',
    scope: { kind: 'group' as const, id: 'group-a', path: 'Groups/sample.md' },
  }
  const target = { id: 'local-image-a', path: 'Private/sample.png', kind: 'attachment' as const }
  try {
    await review.attachments.recordReceived(source, target.id)
    vi.spyOn(database!, 'transaction').mockImplementationOnce(() => {
      throw new DOMException('Connection to Indexed Database server lost', 'UnknownError')
    })
    expect(await review.executables.pending()).toEqual([])
    expect(await review.attachments.mayUpload(source, target)).toBe(true)
    await review.attachments.recordReceived(source, 'local-image-b')
    expect(await review.attachments.mayUpload(source, { ...target, id: 'local-image-b' })).toBe(
      true
    )
  } finally {
    review.close()
    vi.restoreAllMocks()
  }
})

it('reopens actual device IndexedDB with immutable code and independent attachment decisions intact', async () => {
  const factory = new IDBFactory(),
    name = 'sample-device-reviews'
  let store = await IndexedDbStateStore.open(factory, name)
  const source = {
    id: 'connection-a',
    address: 'https://sync.example',
    spaceId: 'space-a',
    tokenId: 'token-a',
    scope: { kind: 'group' as const, id: 'group-a', path: 'Groups/sample.md' },
  }
  const bytes = new TextEncoder().encode('sample code')
  await new ExecutableReview(store).stage({
    source,
    fileId: 'remote-script-a',
    versionId: 'version-a',
    path: 'Scripts/sample.js',
    previousPath: null,
    operation: 'create',
    directory: false,
    bytes,
    sha: await sha256(bytes),
    mtime: 100,
    receivedAt: 200,
  })
  const target = {
      id: 'stable-local-image-a',
      path: 'Private/sample.png',
      kind: 'attachment' as const,
    },
    resolve = async () => target
  const consent = new AttachmentConsent(store)
  await consent.observeNote(source, 'stable-local-note-a', [target.id])
  const [question] = await consent.noteOpened(source, 'stable-local-note-a', { resolve })
  await consent.decide(question.id, true, { resolve })
  store.close()
  store = await IndexedDbStateStore.open(factory, name)
  try {
    expect((await new ExecutableReview(store).pending())[0]).toMatchObject({
      bytes: Array.from(bytes),
      source,
      mtime: 100,
      receivedAt: 200,
    })
    const restarted = new AttachmentConsent(store)
    expect(await restarted.mayUpload(source, target)).toBe(true)
    expect(
      await restarted.mayUpload(
        { ...source, id: 'connection-b', address: 'https://other.example' },
        target
      )
    ).toBe(false)
    expect(await restarted.mayUpload(source, { ...target, id: 'new-file-at-old-path' })).toBe(false)
  } finally {
    store.close()
  }
})

it('uses an independent device writer and keeps another local vault isolated', async () => {
  const factory = new IDBFactory()
  const source = {
    id: 'connection-a',
    address: 'https://sync.example',
    spaceId: 'space-a',
    tokenId: 'token-a',
    scope: { kind: 'group' as const, id: 'group-a', path: 'Groups/sample.md' },
  }
  const target = {
    id: 'stable-local-file-a',
    path: 'Private/sample.png',
    kind: 'attachment' as const,
  }
  let review = await openDeviceReviews(factory, 'local-vault-a')
  await review.attachments.recordReceived(source, target.id)
  review.close()
  review = await openDeviceReviews(factory, 'local-vault-a')
  const other = await openDeviceReviews(factory, 'local-vault-b')
  try {
    expect(await review.attachments.mayUpload(source, target)).toBe(true)
    expect(await other.attachments.mayUpload(source, target)).toBe(false)
    expect(await other.executables.pending()).toEqual([])
  } finally {
    review.close()
    other.close()
  }
})
