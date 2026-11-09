import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { transformSync } from 'esbuild'

const code = readFileSync('tests/e2e/chatTree.e2e.test.ts', 'utf8')
const declaration = code.slice(code.indexOf('const probe ='), code.indexOf('\ndescribe.skipIf'))
const probe = new Function(
  'SHOTS',
  'randomUUID',
  transformSync(declaration + '\nreturn probe', { loader: 'ts' }).code
)('', randomUUID)

it('cleans chat-tree storage when setup fails after creating its directory', async () => {
  const files = new Map<string, unknown>()
  const remove = vi.fn(async (file: { path: string }) => files.delete(file.path))
  const service = {
    activeTabId: { value: null },
    closedNodeChats: { value: [] },
    folders: {
      path: () => 'sample',
      paths: [],
      reload: async () => {},
      remove: async () => {},
      forgetNode: async () => {},
    },
    saveTabs: () => {},
  }
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path),
      createFolder: async (path: string) => files.set(path, { path }),
      create: async () => {
        throw Error('sample setup failure')
      },
      delete: remove,
    },
    workspace: { rightSplit: {}, leftSplit: {} },
  }
  const run = new Function('app', 'window', 'document', 'return ' + probe('sample'))
  await expect(
    run(app, { __abeleTest: { ChatService: { getInstance: () => service } } }, document)
  ).rejects.toThrow('sample setup failure')
  expect(files.size).toBe(0)
  expect(remove).toHaveBeenCalledOnce()
})

it('gives independent chat-tree runs different folder identities', () => {
  const folder = (script: string) => script.match(/const (?:fixture|folder) = ([^\n]+)/)?.[1]
  expect(folder(probe('sample'))).not.toBe(folder(probe('sample')))
})
