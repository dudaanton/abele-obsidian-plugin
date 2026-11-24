// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb'
import { expect, it, vi } from 'vitest'
import { DEVICE_INTENT_FIXTURE } from '../e2e/helpers/deviceIntentFixture'
import { OWNED_MEDIA_FIXTURE } from '../e2e/helpers/ownedMediaFixture'

it('resets and restores durable consent without disturbing other entries or legacy evidence', async () => {
  const indexedDB = new IDBFactory()
  const local = new Map<string, unknown>()
  const app = {
    appId: 'sample-vault',
    loadLocalStorage: (key: string) => local.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => local.set(key, value),
  }
  const intent = new Function(
    'indexedDB',
    'app',
    `${DEVICE_INTENT_FIXTURE};return deviceIntentFixture`
  )(indexedDB, app)
  const key = 'abele-slide-network:sample.md'
  await intent(key, 'restore', { raw: 'true', legacy: false })
  await intent(key + '-other', 'restore', { raw: 'false', legacy: null })
  const snapshot = await intent(key, 'reset')
  expect(snapshot).toEqual({ raw: 'true', legacy: false })
  expect(await intent(key)).toBeNull()
  await intent(key, 'restore', snapshot)
  expect(await intent(key)).toBe(true)
  expect(app.loadLocalStorage(key)).toBe(false)
  expect(await intent(key + '-other')).toBe(false)
  const absent = await intent('abele-slide-network:absent.md', 'reset')
  await intent('abele-slide-network:absent.md', 'restore', { raw: 'true', legacy: null })
  await intent('abele-slide-network:absent.md', 'restore', absent)
  expect(await intent('abele-slide-network:absent.md')).toBeNull()
})

function media(files: Record<string, number[]>, hidden: string[] = [], folders: string[] = []) {
  const root = 'sample-fixture'
  const app = {
    vault: {
      getAbstractFileByPath: () => ({
        children: Object.keys(files).map((name) => ({ path: root + '/' + name })),
      }),
      adapter: {
        readBinary: async (path: string) =>
          new Uint8Array(files[path.slice(root.length + 1)]).buffer,
        list: async () => ({
          files: [...Object.keys(files).map((name) => root + '/' + name), ...hidden],
          folders,
        }),
      },
      delete: vi.fn(async () => {}),
    },
  }
  const remove = new Function('app', `${OWNED_MEDIA_FIXTURE};return removeOwnedMediaFixture`)(app)
  return {
    remove: () => remove(root, { 'sample-fixture.txt': [[1, 2]], 'sample.png': [[3, 4]] }),
    deleted: app.vault.delete,
  }
}

it('recovers a marked partial setup and a completed fixture', async () => {
  for (const files of [
    { 'sample-fixture.txt': [1, 2] },
    { 'sample-fixture.txt': [1, 2], 'sample.png': [3, 4] },
  ]) {
    const fixture = media(files)
    await fixture.remove()
    expect(fixture.deleted).toHaveBeenCalledOnce()
  }
})

it('refuses changed bytes, unknown files, missing proof and hidden disk entries', async () => {
  for (const fixture of [
    media({ 'sample-fixture.txt': [1, 2], 'sample.png': [9] }),
    media({ 'sample-fixture.txt': [1, 2], 'unknown.png': [3, 4] }),
    media({ 'sample.png': [3, 4] }),
    media({ 'sample-fixture.txt': [1, 2] }, ['sample-fixture/.hidden']),
    media({ 'sample-fixture.txt': [1, 2] }, [], ['sample-fixture/nested']),
  ]) {
    await expect(fixture.remove()).rejects.toThrow('not owned')
    expect(fixture.deleted).not.toHaveBeenCalled()
  }
})

it('recovers an unmarked legacy fixture only when its complete baseline matches', async () => {
  const names = ['sample-keep.png', 'sample-links.md', 'sample-ref-one.md', 'sample-ref-two.md']
  const sources = Object.fromEntries(names.map((name) => [name, [[1, 2]]]))
  for (const complete of [true, false]) {
    const children = (complete ? names : names.slice(1)).map((name) => ({ path: 'sample/' + name }))
    const app = {
      vault: {
        getAbstractFileByPath: () => ({ children }),
        adapter: {
          readBinary: async () => new Uint8Array([1, 2]).buffer,
          list: async () => ({ files: children.map((child) => child.path), folders: [] }),
        },
        delete: vi.fn(async () => {}),
      },
    }
    const remove = new Function('app', `${OWNED_MEDIA_FIXTURE};return removeOwnedMediaFixture`)(app)
    if (complete) {
      await remove('sample', sources)
      expect(app.vault.delete).toHaveBeenCalledOnce()
    } else {
      await expect(remove('sample', sources)).rejects.toThrow('not owned')
      expect(app.vault.delete).not.toHaveBeenCalled()
    }
  }
})
