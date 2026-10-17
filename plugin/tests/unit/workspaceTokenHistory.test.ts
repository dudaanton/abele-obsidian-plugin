import { afterEach, expect, it, vi } from 'vitest'
import { registerWorkspaceEvents } from '@/startup/registerWorkspaceEvents'
import { tokenUi } from '@/sync/tokenUi'
import { historyConnection } from '@/sync/tokenHistory'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'

afterEach(() => {
  tokenUi.value = null
  historyConnection.value = null
  GlobalStore.getInstance().versionHistoryPath.value = null
})

type Row = {
  id: string
  address: string
  scope: { kind: 'folder' | 'group'; id: string; path: string }
  holds?: (path: string) => boolean
  history?: boolean
}

/** Right-clicks `path` with these connections and returns the version-history items. */
function historyItems(rows: Row[], path: string) {
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: false }
  const app = useVault([
    { path: 'Agents Test/inside.md', content: 'inside' },
    { path: 'Shared/both.md', content: 'both' },
    { path: 'elsewhere.md', content: 'elsewhere' },
  ])
  Object.assign(app.workspace, { getActiveViewOfType: () => null, getMostRecentLeaf: () => null })
  tokenUi.value = {
    rows: { value: rows.map(({ holds: _holds, history: _history, ...row }) => row) },
    runtimes: new Map(
      rows.map((row) => [
        row.id,
        {
          ...(row.history === false ? {} : { historyClient: {} }),
          acceptsLocal: (one: string) => row.holds?.(one) ?? false,
        },
      ])
    ),
  } as never
  registerWorkspaceEvents({
    app,
    register: vi.fn(),
    registerEvent: vi.fn(),
    addCommand: vi.fn(),
    // The external file tab, embeds and link routing register at the same startup step.
    registerDomEvent: vi.fn(),
    registerView: vi.fn(),
    registerMarkdownPostProcessor: vi.fn(),
    registerEditorExtension: vi.fn(),
  } as never)
  const items: Array<{ title: string; run?: () => void }> = []
  const menu = {
    addItem: (setup: (item: unknown) => void) => {
      const entry = { title: '', run: undefined as (() => void) | undefined }
      const item = {
        setTitle: (title: string) => {
          entry.title = title
          return item
        },
        setIcon: () => item,
        setSection: () => item,
        onClick: (run: () => void) => {
          entry.run = run
          return item
        },
      }
      setup(item)
      items.push(entry)
    },
  }
  app.emit('workspace', 'file-menu', menu, app.vault.getFileByPath(path))
  return items.filter((item) => /version history/i.test(item.title))
}

const inFolder = (folder: string) => (path: string) => path.startsWith(folder + '/')
const agents: Row = {
  id: 'agents',
  address: 'https://sync.example.test/abele',
  scope: { kind: 'folder', id: 'f1', path: 'Agents Test' },
  holds: (path) => inFolder('Agents Test')(path) || inFolder('Shared')(path),
}
const books: Row = {
  id: 'books',
  address: 'http://10.0.0.2:8080',
  scope: { kind: 'group', id: 'g1', path: 'Groups/Books.md' },
  holds: inFolder('Shared'),
}

it('offers no version history on a note outside every connection', () => {
  expect(historyItems([agents, books], 'elsewhere.md')).toEqual([])
})

it('offers one plain item on a note inside one connection', () => {
  const history = historyItems([agents, books], 'Agents Test/inside.md')
  expect(history.map((item) => item.title)).toEqual(['Open version history'])
  history[0].run!()
  expect(historyConnection.value).toBe('agents')
  expect(GlobalStore.getInstance().versionHistoryPath.value).toBe('Agents Test/inside.md')
})

it('names each connection when two hold the same note, never by its server', () => {
  const history = historyItems([agents, books], 'Shared/both.md')
  expect(history.map((item) => item.title)).toEqual([
    'Open version history · Agents Test',
    'Open version history · Books',
  ])
  for (const item of history) expect(item.title).not.toMatch(/http|example\.test|10\.0\.0\.2/)
  history[1].run!()
  expect(historyConnection.value).toBe('books')
  expect(GlobalStore.getInstance().versionHistoryPath.value).toBe('Shared/both.md')
})

it('keeps connections that are not running out of the menu', () => {
  const history = historyItems([agents, { ...books, history: false }], 'Shared/both.md')
  expect(history.map((item) => item.title)).toEqual(['Open version history'])
})

it('tells apart two connections with the same short name', () => {
  const vault = (id: string, address: string): Row => ({
    id,
    address,
    scope: { kind: 'folder', id, path: '/' },
    holds: () => true,
  })
  const titles = historyItems(
    [vault('one', 'https://a.test'), vault('two', 'https://b.test')],
    'elsewhere.md'
  ).map((item) => item.title)
  expect(new Set(titles).size).toBe(2)
  for (const title of titles) expect(title).not.toMatch(/http|a\.test|b\.test/)
})
