import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { openNodeFolderPicker } from '@/node/NodePathDialogs'
import { NodePathClientPort, supportedNodePathCapabilities } from '@/node/NodePathClientPort'
import { NodePathModel } from '@/node/NodePathModel'
import { ChannelError } from '@abele/channel-protocol'
import { MemoryClientStore } from '@abele/node-client'

vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: { getInstance: () => ({ app: { workspace: { containerEl: document.body } } }) },
}))
afterEach(() => {
  document.body.innerHTML = ''
})

it('says the node is not connected instead of doing nothing when Open is pressed', async () => {
  const register = vi.fn()
  const connection = {
    state: ref('connected'),
    client: {
      describe: vi.fn(async () => supportedDescription),
      store: { transaction: async (run: (raw: object) => unknown) => run({}) },
      nodePath: {
        register,
        directories: vi.fn(async (params: { path?: string }) => ({
          directory_id: 'sample-directory',
          path: params.path ?? '/sample',
          entries: [
            {
              name: 'sample-folder',
              path: '/sample/sample-folder',
              directory_id: 'sample-folder-id',
            },
          ],
          cursor: null,
          incomplete: false,
          omissions: [],
        })),
      },
    },
  }
  const model = { capabilities: ref(['node_path_v2']), folders: ref([]) }
  await openNodeFolderPicker(model as never, connection as never)
  await flushPromises()
  connection.state.value = 'offline'
  const field = document.querySelector('.abele-folder-picker input') as HTMLInputElement
  field.value = '/sample/sample-folder'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
  const open = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Open'
  )!
  open.click()
  await flushPromises()
  expect(register).not.toHaveBeenCalled()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('not connected')
})

const supportedDescription = {
  node_id: 'sample-node',
  capabilities: { capabilities: { node_path_v2: { status: 'supported' } } },
}
function pickerFixture(describe: () => Promise<unknown> = async () => supportedDescription) {
  const directories = vi.fn(async (_args?: { path?: string; cursor?: string }) => ({
    path: '/sample',
    directory_id: 'sample-directory',
    entries: [],
    cursor: null as string | null,
    incomplete: false,
    omissions: [],
  }))
  const client = {
    describe: vi.fn(describe),
    nodePath: { directories },
    listProjects: vi.fn(),
    listSessions: vi.fn(),
  }
  const model = { capabilities: ref<string[]>([]), folders: ref([]) }
  return { client, model, connection: { client, state: ref('connected') }, directories }
}
it('waits for describe before the first catalogue has finished', async () => {
  let finish!: (value: typeof supportedDescription) => void
  const f = pickerFixture(
    vi.fn(
      () =>
        new Promise<typeof supportedDescription>((resolve) => {
          finish = resolve
        })
    )
  )
  const opening = openNodeFolderPicker(f.model as never, f.connection as never)
  await flushPromises()
  expect(f.directories).not.toHaveBeenCalled()
  finish(supportedDescription)
  await opening
  expect(f.directories).toHaveBeenCalledWith({})
})
it('opens after the catalogue failed, preserves its error, and allows a catalogue retry', async () => {
  const f = pickerFixture()
  f.client.listProjects.mockRejectedValue(new Error('stale_resource'))
  f.client.listSessions.mockResolvedValue([])
  const port = new NodePathClientPort(f.client as never, {
    nodeId: 'sample-node',
    registrationId: 'sample-registration',
  })
  const model = new NodePathModel('sample-node', 'sample-registration', port, new Map())
  await expect(model.refresh()).rejects.toThrow('stale_resource')
  const catalogueError = model.error.value
  expect(catalogueError).not.toBe('')
  await openNodeFolderPicker(model, f.connection as never)
  expect(model.error.value).toEqual(catalogueError)
  expect(f.directories).toHaveBeenCalledWith({})
  f.client.listProjects.mockResolvedValue([])
  await model.refresh()
  expect(model.error.value).toBe('')
  expect(model.capabilities.value).toContain('node_path_v2')
})
it('reads the nested node.describe capability document', () => {
  expect(supportedNodePathCapabilities(supportedDescription)).toEqual(['node_path_v2'])
})
it('only asks for an update after describe confirms the capability is absent', async () => {
  const f = pickerFixture(
    vi.fn(async () => ({ ...supportedDescription, capabilities: { capabilities: {} } }))
  )
  await expect(openNodeFolderPicker(f.model as never, f.connection as never)).rejects.toThrow(
    'Update this node'
  )
  expect(f.client.describe).toHaveBeenCalledOnce()
  expect(f.directories).not.toHaveBeenCalled()
})
it('preserves a describe failure and retries describe on reopening', async () => {
  const f = pickerFixture()
  f.client.describe.mockRejectedValueOnce(new Error('Connection interrupted'))
  await expect(openNodeFolderPicker(f.model as never, f.connection as never)).rejects.toThrow(
    'Connection interrupted'
  )
  await openNodeFolderPicker(f.model as never, f.connection as never)
  expect(f.directories).toHaveBeenCalledWith({})
})
it('shows a directory read failure and acquires a fresh directory on reopening', async () => {
  const f = pickerFixture()
  f.directories.mockRejectedValueOnce(new Error('stale_resource'))
  await expect(openNodeFolderPicker(f.model as never, f.connection as never)).rejects.toThrow(
    'stale_resource'
  )
  await openNodeFolderPicker(f.model as never, f.connection as never)
  expect(document.querySelector('.abele-folder-picker')).not.toBeNull()
  expect(f.client.describe).toHaveBeenCalledTimes(2)
})

const directoryPage = (
  path: string,
  directory_id = 'fresh-parent',
  cursor: string | null = null
) => ({
  path,
  directory_id,
  entries: [],
  cursor,
  incomplete: false,
  omissions: [],
})
async function typeChild(name = 'created') {
  const field = document.querySelector('.abele-folder-picker input') as HTMLInputElement
  field.value = '/sample/' + name
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}
async function press(label: string) {
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label
  )!
  expect(button).toBeDefined()
  button.click()
  await flushPromises()
}
it.each(['stale_resource', 'stale_cursor'])(
  'restarts a partial directory page once on %s',
  async (code) => {
    const f = pickerFixture()
    f.directories.mockImplementation(async (args?: { path?: string; cursor?: string }) => {
      if (args?.cursor) throw new ChannelError(code)
      if (args?.path === '/') return directoryPage('/')
      return directoryPage('/sample', 'parent', args?.path ? null : 'expired-page')
    })
    await openNodeFolderPicker(f.model as never, f.connection as never)
    expect(f.directories).toHaveBeenCalledWith({ path: '/sample' })
    expect(document.querySelector('.abele-folder-picker')).not.toBeNull()
    await press('Cancel')
  }
)
it('bounds repeated stale pagination instead of opening an incomplete listing', async () => {
  const f = pickerFixture()
  f.directories.mockImplementation(async (args?: { cursor?: string }) => {
    if (args?.cursor) throw new ChannelError('stale_resource')
    return directoryPage('/sample', 'parent', 'expired-page')
  })
  await expect(openNodeFolderPicker(f.model as never, f.connection as never)).rejects.toThrow(
    'stale_resource'
  )
  expect(f.directories).toHaveBeenCalledTimes(4)
})
it('refreshes a stale mkdir parent without replay, preserves the name, and uses a new operation on Create', async () => {
  const f = pickerFixture()
  f.directories.mockImplementation(async (args?: { path?: string }) =>
    directoryPage(args?.path ?? '/sample')
  )
  const mkdir = vi
    .fn()
    .mockRejectedValueOnce(new ChannelError('stale_resource'))
    .mockResolvedValueOnce({ path: '/sample/created' })
  const register = vi.fn().mockRejectedValue(new Error('sample registration failure'))
  const client = {
    ...f.client,
    store: new MemoryClientStore(),
    nodePath: { ...f.client.nodePath, mkdir, register },
  }
  await openNodeFolderPicker(f.model as never, { ...f.connection, client } as never)
  await typeChild()
  await press('Create')
  expect(mkdir).toHaveBeenCalledOnce()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('refreshed')
  expect((document.querySelector('.abele-folder-picker input') as HTMLInputElement).value).toBe(
    '/sample/created'
  )
  await press('Create')
  expect(mkdir).toHaveBeenCalledTimes(2)
  expect(mkdir.mock.calls[1][1]).not.toBe(mkdir.mock.calls[0][1])
  await press('Create')
  expect(mkdir).toHaveBeenCalledTimes(2)
  expect(register).toHaveBeenCalledTimes(2)
  await press('Cancel')
})
it('drops directory handles on reconnect before the next Create', async () => {
  const f = pickerFixture()
  let handle = 'old-parent'
  f.directories.mockImplementation(async (args?: { path?: string }) =>
    directoryPage(args?.path ?? '/sample', handle)
  )
  const mkdir = vi.fn().mockRejectedValue(new ChannelError('outcome_unknown'))
  const client = {
    ...f.client,
    store: new MemoryClientStore(),
    nodePath: { ...f.client.nodePath, mkdir },
  }
  await openNodeFolderPicker(f.model as never, { ...f.connection, client } as never)
  await typeChild()
  f.connection.state.value = 'offline'
  await flushPromises()
  handle = 'new-parent'
  f.connection.state.value = 'connected'
  await flushPromises()
  await press('Create')
  expect(mkdir.mock.calls[0][0].directory_id).toBe('new-parent')
  await press('Cancel')
})
