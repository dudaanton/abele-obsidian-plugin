import type { App } from 'obsidian'
import { buildFakeVault, type FakeFileSpec } from './fakeVault'
import { guardTrashRevision, registerRevisionTrash } from '@/services/revisionTrash'

/** The native adapter queue contract, without changing unrelated fake-vault callers. */
export function queuedCommentVault(specs: FakeFileSpec[]) {
  const fake = buildFakeVault(specs)
  const app = fake as unknown as App
  const read = app.vault.read.bind(app.vault)
  const modify = app.vault.modify.bind(app.vault)
  const trash = app.vault.trash.bind(app.vault)
  let tail: Promise<unknown> = Promise.resolve()
  const removed: string[] = []
  const adapter = app.vault.adapter as unknown as {
    queue<T>(action: () => Promise<T>): Promise<T>
    read(path: string): Promise<string>
    exists(path: string): Promise<boolean>
    trashLocal(path: string): Promise<void>
  }
  adapter.queue = <T>(action: () => Promise<T>) => {
    const task = tail.catch(() => {}).then(action)
    tail = task
    return task
  }
  adapter.read = (path) => adapter.queue(() => read(app.vault.getFileByPath(path)!))
  adapter.exists = async (path) => !!app.vault.getFileByPath(path)
  adapter.trashLocal = (path) =>
    guardTrashRevision(adapter, path, () =>
      adapter.queue(async () => {
        const file = app.vault.getFileByPath(path)!
        removed.push(await read(file))
        await trash(file, true)
      })
    )
  registerRevisionTrash(adapter)
  app.fileManager.trashFile = (file) => adapter.trashLocal(file.path)
  app.vault.modify = (file, content) =>
    adapter.queue(async () => {
      if (app.vault.getFileByPath(file.path)) await modify(file, content)
      else await app.vault.create(file.path, content)
    })
  return { app, fake, adapter, removed }
}
