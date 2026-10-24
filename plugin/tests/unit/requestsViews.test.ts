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
    RequestsContextSchema: z.object({
      registrationId: z.string(),
      projectId: z.string(),
      worktreeId: z.string().optional(),
    }),
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

it('shows file variables in the request tab while masking file environment secrets', async () => {
  const { shownVars } = await import('@/requests/views')
  const { RequestsModel } = await import('@/requests/RequestsModel')
  const { fakeNode, ports } = await import('../helpers/requestsFakeNode')
  const contents: Record<string, string> = {
    'sample.http': '@base = https://example.test\nGET {{base}}/samples?token={{token}}',
    'http-client.env.json': '{"dev":{"token":"sample-private-value"}}',
  }
  const model = new RequestsModel(
    fakeNode().rpc,
    'sample-project',
    ports({
      files: {
        list: async () => Object.keys(contents),
        read: async (path) => ({ text: contents[path], contentId: path }),
        write: async () => {},
        watch: async () => () => {},
      },
    })
  )
  await model.load()
  await model.selectEnvironment(model.files!.environments[0].id)
  const id = model.files!.collections[0].requests[0].id
  await model.open(id)
  const values = shownVars(model, model.entry(id).doc!)
  expect(values).toContainEqual({ key: 'base', value: 'https://example.test' })
  expect(JSON.stringify(values)).not.toContain('sample-private-value')
  expect(values.find((v) => v.key === 'token')?.secret).toBe(true)
})

it.each(['sample-private-value', 'sample-private-value${abele_key:sample-key}'])(
  'masks and redacts file environment secret %s for saved requests too',
  async (secret) => {
    const { shownVars } = await import('@/requests/views')
    const node = fakeNode()
    const id = 'Samples/Create sample.http'
    node.files.set(
      id,
      doc({ url: 'https://example.test/{{token}}', headers: [], params: [], body: undefined })
    )
    const model = new RequestsModel(
      node.rpc,
      'project-1',
      ports({
        files: {
          list: async () => ['sample.http', 'http-client.env.json'],
          read: async (path) => ({
            text: path.endsWith('.json')
              ? JSON.stringify({ dev: { token: secret } })
              : 'GET https://example.test',
            contentId: path,
          }),
          write: async () => {},
          watch: async () => () => {},
        },
      })
    )
    await model.load()
    await model.selectEnvironment(model.files!.environments[0].id)
    await model.open(id)
    expect(JSON.stringify(shownVars(model, model.entry(id).doc!))).not.toContain(
      'sample-private-value'
    )
    await model.send(id, { interactive: true })
    expect(node.sent[0].secrets).toContain('sample-private-value')
  }
)
