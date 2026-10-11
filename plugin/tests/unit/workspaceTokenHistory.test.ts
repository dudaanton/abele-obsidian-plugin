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

it('keeps extracted workspace history actions scoped to each current token engine', () => {
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: false }
  const app = useVault([{ path: 'sample.md', content: 'sample' }])
  Object.assign(app.workspace, { getActiveViewOfType: () => null, getMostRecentLeaf: () => null })
  const rows = [
    { id: 'first', address: 'server-one' },
    { id: 'second', address: 'server-two' },
    { id: 'starting', address: 'server-three' },
  ]
  tokenUi.value = {
    rows: { value: rows },
    runtimes: new Map([
      ['first', { historyClient: {} }],
      ['second', { historyClient: {} }],
    ]),
  } as never
  registerWorkspaceEvents({
    app,
    register: vi.fn(),
    registerEvent: vi.fn(),
    addCommand: vi.fn(),
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
  app.emit('workspace', 'file-menu', menu, app.vault.getFileByPath('sample.md'))
  const history = items.filter((item) => item.title.startsWith('Open version history'))
  expect(history.map((item) => item.title)).toEqual([
    'Open version history (Abele) · server-one',
    'Open version history (Abele) · server-two',
  ])
  history[1].run!()
  expect(historyConnection.value).toBe('second')
  expect(GlobalStore.getInstance().versionHistoryPath.value).toBe('sample.md')
})
