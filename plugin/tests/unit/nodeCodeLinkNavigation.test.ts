import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Platform, type Plugin } from 'obsidian'
import { nodeCodeLink } from '@/node/codeLinks'
import { registerNodeCodeLinks } from '@/node/registerCodeLinks'
import { openNodeCodeLink } from '@/node/openNodeCodeLink'
import { guardExternalLinks } from '@/markdown/externalLinks'

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  open: vi.fn(),
  ready: vi.fn(),
  notice: vi.fn(),
  nodes: [] as { id: string; expectedNodeId: string }[],
  targets: [] as unknown[],
}))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      nodes: { value: mocks.nodes },
      connection: () => ({ connect: mocks.connect }),
    }),
  },
}))
vi.mock('@/node/NodePathService', () => ({
  NodePathService: {
    getInstance: () => ({
      ready: mocks.ready,
      model: () => ({ targets: { value: mocks.targets }, error: { value: '' } }),
    }),
  },
}))
vi.mock('@/node/nodeChatPlace', () => ({ openNodeChatResource: mocks.open }))
vi.mock('@/node/errorNotice', () => ({ nodeErrorNotice: mocks.notice }))

const target = {
  nodeId: 'sample-node',
  registrationId: 'old-device-registration',
  projectId: 'sample-project',
  kind: 'worktree' as const,
  id: 'sample-tree',
}
const resource = nodeCodeLink(target, 'src/sample.ts', { start: 3, end: 7 })
const cleanups: (() => void)[] = []
let windowOpened: (_workspace: unknown, win: { document: Document }) => void

function register() {
  registerNodeCodeLinks({
    app: {
      workspace: {
        iterateAllLeaves: vi.fn(),
        on: (_name: string, callback: typeof windowOpened) => {
          windowOpened = callback
        },
      },
    },
    registerEvent: vi.fn(),
    registerDomEvent: (doc: Document, name: string, callback: EventListener, options: boolean) => {
      doc.addEventListener(name, callback, options)
      cleanups.push(() => doc.removeEventListener(name, callback, options))
    },
  } as unknown as Plugin)
}

beforeEach(() => {
  mocks.nodes = [{ id: 'current-device-registration', expectedNodeId: target.nodeId }]
  mocks.targets = [{ ...target, registrationId: mocks.nodes[0].id }]
  mocks.connect.mockResolvedValue(undefined)
  mocks.ready.mockResolvedValue(undefined)
  mocks.open.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  document.body.replaceChildren()
  vi.restoreAllMocks()
  Reflect.deleteProperty(Platform, 'isAndroidApp')
})

it('opens an owner citation using this device registration without any chat scope', async () => {
  await openNodeCodeLink(resource)
  expect(mocks.connect).toHaveBeenCalledOnce()
  expect(mocks.open).toHaveBeenCalledWith(resource, {
    ...target,
    registrationId: 'current-device-registration',
  })
})

it.each([
  'missing registration',
  'ambiguous registration',
  'missing target',
  'offline',
  'forbidden',
])('reports %s without guessing another node or folder', async (failure) => {
  if (failure === 'missing registration') mocks.nodes = []
  if (failure === 'ambiguous registration') mocks.nodes.push({ ...mocks.nodes[0], id: 'duplicate' })
  if (failure === 'missing target') mocks.targets = [{ ...target, id: 'other-tree' }]
  if (failure === 'offline' || failure === 'forbidden')
    mocks.connect.mockRejectedValueOnce(new Error(failure))
  await expect(openNodeCodeLink(resource)).rejects.toThrow()
  expect(mocks.open).not.toHaveBeenCalled()
})

it.each(['abele-node-code:broken', nodeCodeLink(target, '../secret.ts')])(
  'refuses a malformed citation before connecting: %s',
  async (link) => {
    await expect(openNodeCodeLink(link)).rejects.toThrow()
    expect(mocks.connect).not.toHaveBeenCalled()
  }
)

it.each(['markdown-reading-view', 'canvas-node-content', 'abele-markdown', 'hover-popover'])(
  'captures %s links before Obsidian or a component can launch an external application',
  async (surface) => {
    register()
    const root = document.body.createDiv({ cls: surface })
    const link = root.createEl('a', { attr: { href: resource } })
    const child = link.createEl('code', { text: 'source' })
    const external = vi.fn()
    root.addEventListener('click', external)
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
    child.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(true)
    expect(external).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce())
  }
)

it('handles guarded Markdown and middle clicks, and shows failures instead of handing them to the OS', async () => {
  register()
  const root = document.body.createDiv()
  const link = root.createEl('a', { attr: { href: resource } })
  guardExternalLinks(root)
  mocks.connect.mockRejectedValueOnce(new Error('forbidden'))
  const evt = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })
  link.dispatchEvent(evt)
  expect(evt.defaultPrevented).toBe(true)
  await vi.waitFor(() =>
    expect(mocks.notice).toHaveBeenCalledWith(expect.objectContaining({ message: 'forbidden' }))
  )
})

it('captures invalid citations too, while leaving web and local note links alone', async () => {
  register()
  const link = document.body.createEl('a', { attr: { href: 'abele-node-code:broken' } })
  const evt = new MouseEvent('click', { bubbles: true, cancelable: true })
  link.dispatchEvent(evt)
  expect(evt.defaultPrevented).toBe(true)
  await vi.waitFor(() => expect(mocks.notice).toHaveBeenCalledOnce())
  for (const href of ['https://example.test', 'mailto:sample@example.test', 'Sample.md']) {
    link.setAttribute('href', href)
    const other = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(other)
    expect(other.defaultPrevented).toBe(false)
  }
})

it('handles links in popout documents as well as the main window', async () => {
  register()
  const doc = document.implementation.createHTMLDocument('Sample')
  windowOpened({}, { document: doc })
  const link = doc.createElement('a')
  link.setAttribute('href', resource)
  doc.body.append(link)
  const evt = new MouseEvent('click', { bubbles: true, cancelable: true })
  link.dispatchEvent(evt)
  expect(evt.defaultPrevented).toBe(true)
  await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce())
})

it.each([false, true])('opens styled Markdown editor links (Live Preview: %s)', async (live) => {
  register()
  const root = document.body.createDiv({ cls: live ? 'is-live-preview' : 'is-source-mode' })
  const editor = root.createDiv({ cls: 'cm-editor' })
  const label = editor.createEl('span', { cls: 'cm-link', text: 'source' })
  const state = EditorState.create({ doc: `See [source](${resource})` })
  vi.spyOn(EditorView, 'findFromDOM').mockReturnValue({
    state,
    posAtDOM: () => 6,
  } as unknown as EditorView)
  const evt = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: !live })
  label.dispatchEvent(evt)
  expect(evt.defaultPrevented).toBe(true)
  await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce())
})

it('prevents Android mousedown navigation and consumes the subsequent click without opening twice', async () => {
  Object.assign(Platform, { isAndroidApp: true })
  register()
  const link = document.body.createEl('a', { attr: { href: resource } })
  for (const type of ['mousedown', 'click']) {
    const evt = new MouseEvent(type, { bubbles: true, cancelable: true })
    link.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(true)
  }
  await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce())
})
