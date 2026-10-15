import { expect, it, vi } from 'vitest'
import type { Plugin, Command, Menu } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { registerExternalFileActions } from '@/sync/external/registerActions'
import { ExternalFileActions } from '@/sync/external/fileActions'
import { externalActionsOf } from '@/sync/external/actionHost'
import { confirmDialog } from '@/components/obsidian/dialogs'
import { previewRule, readRule, saveRule } from '@/sync/external/rules'
import { tokenOffloadsOf } from '@/sync/tokenOffloadCoordinator'
import { pathCoordinatorOf } from '@/sync/pathCoordinator'
import { flushPromises } from '@vue/test-utils'

vi.mock('@/components/obsidian/dialogs', () => ({ confirmDialog: vi.fn(async () => false) }))

it('opens offloaded linked books as a card without downloading and retains the position fragment', async () => {
  const app = useVault([])
  const open = vi.fn(async () => {})
  const setViewState = vi.fn(async () => {})
  Object.assign(app.workspace, {
    getActiveFile: () => null,
    openLinkText: open,
    getLeaf: () => ({ setViewState }),
  })
  const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
  manager.remember('sample', [{ path: 'Books/sample.epub', size: 100, mtime: 1 }], [])
  const hydrate = vi.fn(async () => {})
  manager.hydrator('sample', hydrate)
  let follow!: (event: MouseEvent) => void
  registerExternalFileActions({
    app,
    registerEvent: () => {},
    addCommand: () => {},
    registerDomEvent: (_doc: Document, _name: string, callback: typeof follow) => {
      follow = callback
    },
  } as unknown as Plugin)
  const link = document.createElement('a')
  link.className = 'internal-link'
  link.setAttribute('data-href', 'Books/sample.epub#page=4')
  const event = new MouseEvent('click', { cancelable: true })
  Object.defineProperty(event, 'target', { value: link })
  follow(event)
  expect(event.defaultPrevented).toBe(true)
  expect(open).not.toHaveBeenCalled()
  await flushPromises()
  expect(hydrate).not.toHaveBeenCalled()
  expect(setViewState).toHaveBeenCalledWith({
    type: 'abele-external-file',
    active: true,
    state: { path: 'Books/sample.epub', subpath: '#page=4' },
  })
})

it('previews folders and selections without effects; cancel keeps files; pin toggles and download does not open', async () => {
  const app = useVault([
    { path: 'Media/sample.bin', content: 'abc' },
    { path: 'Media/Nested/other.bin', content: '12345' },
  ])
  const commands: Command[] = []
  const plugin = {
    app,
    registerEvent: () => {},
    registerDomEvent: () => {},
    addCommand: (command: Command) => commands.push(command),
  } as unknown as Plugin
  let pinned = false
  const evict = vi.fn(async () => ({ status: 'complete', reclaimedBytes: 3 }))
  const pin = vi.fn(async (_path: string, value: boolean) => {
    pinned = value
  })
  const hydrate = vi.fn(async () => {})
  const actions = new ExternalFileActions({
    inspect: async (path) => ({
      path,
      size: path.includes('Nested') ? 5 : 3,
      version: 'v',
      pinned,
      blocked: null,
    }),
    evict,
  })
  externalActionsOf.set(app.vault, { actions: () => actions, pin, hydrate })
  registerExternalFileActions(plugin)
  const callbacks = new Map<string, () => Promise<void>>()
  const menu = {
    addItem: (build: (item: unknown) => void) => {
      let title = ''
      const item = {
        setTitle: (value: string) => {
          title = value
          return item
        },
        setIcon: () => item,
        onClick: (callback: () => Promise<void>) => {
          callbacks.set(title, callback)
          return item
        },
      }
      build(item)
    },
  } as unknown as Menu
  app.emit('workspace', 'file-menu', menu, app.vault.getAbstractFileByPath('Media'))
  await callbacks.get('Keep only on the server')!()
  expect(confirmDialog).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringContaining('2 files'), size: 'tall' })
  )
  expect(evict).not.toHaveBeenCalled()
  await callbacks.get('Keep on this device')!()
  expect(pin).toHaveBeenCalledWith('Media/sample.bin', true)
  await callbacks.get('Keep on this device')!()
  expect(pin).toHaveBeenCalledWith('Media/sample.bin', false)
  await callbacks.get('Download to this device')!()
  expect(hydrate).toHaveBeenCalledWith('Media/sample.bin')
  expect(commands.map((command) => command.name)).toEqual([
    'Keep only on the server',
    'Keep on this device',
    'Download to this device',
  ])
  externalActionsOf.delete(app.vault)
})

it('stores rules per connection on this device and only previews until explicitly applied', async () => {
  const app = useVault([
    { path: 'Media/sample.pdf', content: 'abc' },
    { path: 'Media/other.png', content: 'image' },
  ])
  const evict = vi.fn(async () => ({ status: 'complete', reclaimedBytes: 3 }))
  const actions = new ExternalFileActions({
    inspect: async (path) => ({ path, size: 3, version: 'v', pinned: false, blocked: null }),
    evict,
  })
  const select = vi.fn(() => actions)
  externalActionsOf.set(app.vault, { actions: select, pin: vi.fn(), hydrate: vi.fn() })
  const rule = { folder: 'Media', extensions: ['pdf'], minBytes: 1, unopenedDays: 0 }
  saveRule(app as never, 'first', rule)
  expect(readRule(app as never, 'second').extensions).toEqual([])
  expect(readRule(app as never, 'first')).toEqual(rule)
  const result = await previewRule(app as never, 'first', rule)
  expect(result.preview.files.map((file) => file.path)).toEqual(['Media/sample.pdf'])
  expect(select).toHaveBeenCalledWith('first')
  expect(evict).not.toHaveBeenCalled()
  externalActionsOf.delete(app.vault)
})

it('rechecks last-opened age after confirmation instead of applying an obsolete rule match', async () => {
  const app = useVault([{ path: 'Media/sample.pdf', content: 'abc' }])
  app.saveLocalStorage('abele-external-last-opened-v1', { 'Media/sample.pdf': 1 })
  const evict = vi.fn(async () => ({ status: 'complete', reclaimedBytes: 3 }))
  const actions = new ExternalFileActions({
    inspect: async (path) => ({ path, size: 3, version: 'v', pinned: false, blocked: null }),
    evict,
  })
  externalActionsOf.set(app.vault, { actions: () => actions, pin: vi.fn(), hydrate: vi.fn() })
  const result = await previewRule(app as never, 'sample', {
    folder: 'Media',
    extensions: [],
    minBytes: 0,
    unopenedDays: 7,
  })
  expect(result.preview.files).toHaveLength(1)
  app.saveLocalStorage('abele-external-last-opened-v1', { 'Media/sample.pdf': Date.now() })
  expect((await result.actions.apply(result.preview))[0].status).toBe('rule-no-longer-matches')
  expect(evict).not.toHaveBeenCalled()
  externalActionsOf.delete(app.vault)
})
