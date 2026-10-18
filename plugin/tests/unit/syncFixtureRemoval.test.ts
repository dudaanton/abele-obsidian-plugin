// @vitest-environment node
import { expect, it, vi } from 'vitest'
vi.mock('../e2e/helpers/obsidianCli', () => ({ vaultCli: vi.fn() }))
import { SyncDriver } from '../e2e/helpers/syncDriver'

/**
 * A vault shaped like Obsidian's where it matters here: deleting an indexed file costs time
 * proportional to the index, and deleting an indexed folder pays it for every file under it in
 * one synchronous run, as Obsidian's metadata cache does when it rescans every cached note per
 * deleted note.
 */
interface Node {
  path: string
  children?: Node[]
  parent?: Node
}
function fakeVault(files: string[], costMs: number) {
  const index = new Map<string, Node>()
  const root: Node = { path: '', children: [] }
  const folder = (path: string): Node => {
    if (!path) return root
    const known = index.get(path)
    if (known) return known
    const parent = folder(path.split('/').slice(0, -1).join('/'))
    const made: Node = { path, children: [], parent }
    parent.children!.push(made)
    index.set(path, made)
    return made
  }
  for (const path of files) {
    const parent = folder(path.split('/').slice(0, -1).join('/'))
    const made: Node = { path, parent }
    parent.children!.push(made)
    index.set(path, made)
  }
  const busy = (ms: number) => {
    const until = Date.now() + ms
    while (Date.now() < until) {
      /* the page's main thread at work */
    }
  }
  const drop = (node: Node) => {
    for (const child of [...(node.children ?? [])]) drop(child)
    if (!node.children) busy(costMs)
    index.delete(node.path)
    node.parent!.children = node.parent!.children!.filter((one) => one !== node)
  }
  const folderDeletes: { path: string; indexedFilesInside: number }[] = []
  const vault = {
    getAbstractFileByPath: (path: string) => index.get(path) ?? null,
    delete: async (node: Node) => {
      await Promise.resolve()
      if (node.children)
        folderDeletes.push({
          path: node.path,
          indexedFilesInside: [...index.keys()].filter(
            (one) => one.startsWith(node.path + '/') && !index.get(one)!.children
          ).length,
        })
      drop(node)
    },
    adapter: {
      stat: async () => null,
      exists: async (path: string) => index.has(path),
      remove: async () => {},
    },
  }
  return { app: { vault }, index, folderDeletes }
}
const run = (script: string, app: unknown): Promise<unknown> =>
  new Function('app', `return (async()=>{${script}})()`)(app) as Promise<unknown>

/** The page script each driver call would send, run against the fake vault instead. */
function driverOn(app: unknown) {
  const driver = new SyncDriver(() => {
    throw new Error('No live vault in a unit test')
  })
  const sent: Promise<unknown>[] = []
  vi.spyOn(driver, 'run').mockImplementation(((body: string) => {
    sent.push(run(body, app))
    return true
  }) as never)
  vi.spyOn(driver, 'long').mockImplementation(((_what: string, body: string) =>
    run(body, app)) as never)
  return { driver, sent }
}
const tree = (count: number) =>
  Array.from(
    { length: count },
    (_, i) => `Sync fixtures sample/Bucket-${i % 4}/Deeper/Sample-${i}.md`
  )

it('acts like a user on remove(): one native folder deletion with its notes still inside', async () => {
  const { app, index, folderDeletes } = fakeVault(tree(12), 0)
  const { driver, sent } = driverOn(app)
  driver.remove(['Sync fixtures sample'])
  await Promise.all(sent)
  expect(folderDeletes).toEqual([{ path: 'Sync fixtures sample', indexedFilesInside: 12 }])
  expect(index.size).toBe(0)
})

it('tears a large fixture tree down note by note, so no single step holds the page', async () => {
  const { app, index, folderDeletes } = fakeVault(tree(60), 5)
  const { driver } = driverOn(app)
  // A timer set when removal starts stands for the next CLI call the test sends the page.
  let answeredAfter: number | null = null
  const started = Date.now()
  setTimeout(() => (answeredAfter = Date.now() - started), 0)
  await driver.removeTree(['Sync fixtures sample'], true)
  expect(index.size).toBe(0)
  // Folders go only once nothing indexed is left under them.
  expect(folderDeletes.length).toBeGreaterThan(0)
  for (const one of folderDeletes) expect(one.indexedFilesInside).toBe(0)
  // 60 notes at 5 ms each is 300 ms of work; the page answers within a step or two of it.
  expect(answeredAfter).not.toBeNull()
  expect(answeredAfter!).toBeLessThan(150)
})

it('removes a single note and refuses an unindexed directory on both paths', async () => {
  for (const teardown of [false, true]) {
    const { app, index } = fakeVault(['Lone/Sample.md'], 0)
    const { driver, sent } = driverOn(app)
    const remove = async (paths: string[]) => {
      if (teardown) return driver.removeTree(paths, true)
      driver.remove(paths)
      await Promise.all(sent.splice(0))
    }
    await remove(['Lone/Sample.md'])
    expect(index.has('Lone/Sample.md')).toBe(false)
    app.vault.adapter.stat = (async () => ({ type: 'folder' })) as never
    await expect(remove(['Unindexed'])).rejects.toThrow(
      'Unindexed directory requires explicit cleanup: Unindexed'
    )
  }
})
