import { beforeEach, expect, it, vi } from 'vitest'
import { Notice, type App, type WorkspaceLeaf } from 'obsidian'
import { RequestsModel } from '@/requests/RequestsModel'
import { doc, fakeNode, ports } from '../helpers/requestsFakeNode'
import { useVault } from '../helpers/testEnv'

const host = vi.hoisted(() => ({ model: undefined as unknown }))
vi.mock('@/requests/RequestsService', async () => {
  const { z } = await import('zod')
  return {
    keyPort: { has: () => true },
    RequestsContextSchema: z.object({ registrationId: z.string(), projectId: z.string() }),
    RequestsService: {
      instance: () => ({
        model: () => host.model,
        openRequest: {},
        context: { value: { registrationId: 'node-1', projectId: 'project-1' } },
      }),
    },
  }
})
vi.mock('@/views/revealSidebarView', () => ({ revealSidebarView: vi.fn(async () => {}) }))
import { RequestTab, openRequestsView, importFromClipboard } from '@/requests/views'

beforeEach(() => useVault([]))

it('shows import progress immediately and prevents a second import until it finishes', async () => {
  let finish!: (value: string) => void
  const readText = vi
    .fn(async () => 'invalid sample')
    .mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        })
    )
  vi.stubGlobal('navigator', { clipboard: { readText } })
  const pending = importFromClipboard()
  try {
    await importFromClipboard()
    expect(readText).toHaveBeenCalledOnce()
    expect(Notice.shown.at(-1)).toBe('Importing requests…')
  } finally {
    finish('invalid sample')
    await pending
    vi.unstubAllGlobals()
  }
})

it('includes the collection in otherwise identical request tab titles', async () => {
  const node = fakeNode()
  node.files.set('First/Read.http', doc({ name: 'Read' }))
  node.files.set('Second/Read.http', doc({ name: 'Read' }))
  const model = new RequestsModel(node.rpc, 'project-1', ports())
  host.model = model
  await model.load()
  const titles: string[] = []
  for (const collection of ['First', 'Second']) {
    const id = `${collection}/Read.http`
    await model.open(id)
    const tab = new RequestTab({} as WorkspaceLeaf)
    await tab.setState({ registrationId: 'node-1', projectId: 'project-1', id }, {})
    titles.push(tab.getDisplayText())
  }
  expect(titles).toEqual(['Read · First', 'Read · Second'])
})

it('loads the remembered project when revealing an already restored Requests view', async () => {
  const node = fakeNode()
  const model = new RequestsModel(node.rpc, 'project-1', ports())
  host.model = model
  const leaf = { getViewState: () => ({ type: 'abele-requests' }) }
  const app = { workspace: { getLeavesOfType: () => [leaf] } } as unknown as App
  await openRequestsView(app, false)
  expect(model.state.collections[0]?.requests[0]?.id).toBe('Samples/Create sample.http')
  expect(model.state.environment).toBe('local')
})
