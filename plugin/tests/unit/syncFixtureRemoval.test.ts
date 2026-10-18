// @vitest-environment node
import { expect, it, vi } from 'vitest'
vi.mock('../e2e/helpers/obsidianCli', () => ({ vaultCli: vi.fn() }))
import { removal } from '../e2e/helpers/syncDriver'

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

it('removes a large fixture tree note by note, so no single step holds the page', async () => {
  const files = Array.from(
    { length: 60 },
    (_, i) => `Sync fixtures sample/Bucket-${i % 4}/Deeper/Sample-${i}.md`
  )
  const { app, index, folderDeletes } = fakeVault(files, 5)
  // A timer set when removal starts stands for the next CLI call the test sends the page.
  let answeredAfter: number | null = null
  const started = Date.now()
  setTimeout(() => (answeredAfter = Date.now() - started), 0)
  await expect(run(removal(['Sync fixtures sample']), app)).resolves.toBe(true)
  expect(index.size).toBe(0)
  // Folders go only once nothing indexed is left under them.
  expect(folderDeletes.length).toBeGreaterThan(0)
  for (const one of folderDeletes) expect(one.indexedFilesInside).toBe(0)
  // 60 notes at 5 ms each is 300 ms of work; the page answers within a step or two of it.
  expect(answeredAfter).not.toBeNull()
  expect(answeredAfter!).toBeLessThan(150)
})

it('still removes a single note and refuses an unindexed directory', async () => {
  const { app, index } = fakeVault(['Lone/Sample.md'], 0)
  await expect(run(removal(['Lone/Sample.md']), app)).resolves.toBe(true)
  expect(index.has('Lone/Sample.md')).toBe(false)
  app.vault.adapter.stat = (async () => ({ type: 'folder' })) as never
  await expect(run(removal(['Unindexed']), app)).rejects.toThrow(
    'Unindexed directory requires explicit cleanup: Unindexed'
  )
})
