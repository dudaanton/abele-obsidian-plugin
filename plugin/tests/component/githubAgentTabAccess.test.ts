import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceLeaf, type App } from 'obsidian'
import { GithubView } from '@/github/GithubView'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { githubSettingsFrom } from '@/github/settings'
import { GithubUsers, setGithubUsers } from '@/github/users'
import { useVault } from '../helpers/testEnv'
import { flushPromises } from '@vue/test-utils'
import { createGithubTools } from '@/ai/tools/github'
import { basePins } from '@/github/comparison/pins'

const request = vi.hoisted(() => vi.fn())
vi.mock('@/github/transport', () => ({ singleHopRequest: request }))
let view: GithubView | undefined
beforeEach(() => {
  request.mockReset()
  AgentRegistry.destroy()
  setGithubUsers(new GithubUsers())
})
afterEach(async () => {
  await view?.onClose()
  view?.containerEl.remove()
  view = undefined
  vi.restoreAllMocks()
})

function setup(mode: 'off' | 'ask') {
  const app = useVault([])
  const config = AbeleConfig.getInstance()
  config.ai = { ...DEFAULT_AI_SETTINGS, agents: [] }
  config.github = githubSettingsFrom({
    enabled: true,
    connections: [
      {
        id: 'default',
        name: 'Default',
        server: '',
        keyId: 'default-sample-key',
        owners: [],
        isDefault: true,
      },
      {
        id: 'selected',
        name: 'Selected',
        server: '',
        keyId: 'selected-sample-key',
        owners: [],
        isDefault: false,
      },
    ],
  })
  app.secretStorage.setSecret('default-sample-key', 'invented-default')
  app.secretStorage.setSecret('selected-sample-key', 'invented-selected')
  const agent = AgentRegistry.getInstance().create({
    name: 'Sample agent',
    githubConnections: { default: mode, selected: 'auto' },
  })
  const leaf = new WorkspaceLeaf()
  view = new GithubView(leaf)
  view.app = app as unknown as App
  Object.defineProperty(view, 'contentEl', { value: view.containerEl.children[1] })
  Object.assign(app, {
    workspace: {
      requestSaveLayout: vi.fn(),
      getLeavesOfType: () => [leaf],
      getLeaf: () => leaf,
      revealLeaf: vi.fn(async () => {}),
    },
  })
  leaf.view = view
  document.body.append(view.containerEl)
  request.mockImplementation(async (r) => ({
    status: 200,
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
    text: '',
    json: r.url.endsWith('/graphql')
      ? { data: { u0: { login: 'sample-author', name: 'Sample Author', avatarUrl: '' } } }
      : r.url.includes('/comments')
        ? []
        : {
            number: 1,
            title: 'Sample issue',
            state: 'open',
            labels: [],
            body: 'Sample body',
            user: { login: 'sample-author' },
            html_url: 'https://github.com/sample/repo/issues/1',
            created_at: '2026-01-01',
          },
  }))
  return { app, agent, view, leaf }
}

describe('an agent-opened tab capability', () => {
  it('refreshes a loaded pinned file offline through the same live agent capability', async () => {
    const { app, agent, view, leaf } = setup('off'),
      base = 'a'.repeat(40),
      target = 'b'.repeat(40)
    basePins(app as unknown as App).save({
      origin: 'https://github.com',
      owner: 'sample',
      repo: 'repo',
      enteredRef: 'base',
      baseSha: base,
    })
    request.mockImplementation(async (r) => {
      const path = new URL(r.url).pathname
      const json = path.includes('/git/trees/')
        ? {
            tree: [
              {
                path: 'file.ts',
                type: 'blob',
                sha: path.endsWith(base) ? 'before' : 'after',
                mode: '100644',
                size: 8,
              },
            ],
          }
        : { encoding: 'base64', content: btoa(path.endsWith('/before') ? 'old\n' : 'new\n') }
      return {
        status: 200,
        headers: {},
        json,
        text: JSON.stringify(json),
        arrayBuffer: new ArrayBuffer(0),
      }
    })
    vi.spyOn(leaf, 'setViewState').mockImplementation(async (state) =>
      view.setState(state.state, { history: false })
    )
    await createGithubTools({ agent: () => agent })
      .find((t) => t.name === 'github_open')!
      .execute('sample-pinned', {
        url: `https://github.com/sample/repo/blob/${target}/file.ts`,
        connection: 'Selected',
      })
    await view.onOpen()
    await vi.waitFor(() =>
      expect(view.containerEl.querySelector('.abele-github-pinned .cm-editor')).not.toBeNull()
    )
    const calls = request.mock.calls.length
    request.mockImplementation(async () => {
      throw new Error('Offline')
    })
    const refresh = view.containerEl.querySelector<HTMLElement>(
      '.abele-github-header__actions [aria-label="Load again from GitHub"]'
    )!
    expect(refresh).not.toBeNull()
    refresh.click()
    await flushPromises()
    await vi.waitFor(() =>
      expect(view.containerEl.querySelector('.abele-github-pinned .cm-editor')).not.toBeNull()
    )
    expect(request).toHaveBeenCalledTimes(calls)
    expect(view.containerEl.textContent).not.toContain('not cached for offline')
    agent.githubConnections!.selected = 'off'
    refresh.click()
    await flushPromises()
    expect(view.model.screen.title).toBe('')
    expect(view.containerEl.querySelector('.abele-github-pinned .cm-editor')).toBeNull()
    expect(request).toHaveBeenCalledTimes(calls)
  })
  it('does not reuse an Ask grant for a replacement token when the tab reloads', async () => {
    const { app, agent, view, leaf } = setup('off')
    agent.githubConnections!.selected = 'ask'
    vi.spyOn(leaf, 'setViewState').mockImplementation(async (state) =>
      view.setState(state.state, { history: false })
    )
    const approve = vi.fn(async () => true)
    const tool = createGithubTools({ agent: () => agent, approve }).find(
      (t) => t.name === 'github_open'
    )!
    await tool.execute('grant-once', {
      url: 'https://github.com/sample/repo/issues/1',
      connection: 'Selected',
    })
    view.model.tree = false
    await view.onOpen()
    await vi.waitFor(() => expect(view.containerEl.textContent).toContain('Sample Author'))
    expect(approve).toHaveBeenCalledOnce()
    expect(view.getState()).not.toHaveProperty('approvedConnections')
    app.secretStorage.setSecret('selected-sample-key', 'invented-replacement')
    AbeleConfig.getInstance().version.value++
    await flushPromises()
    expect(
      request.mock.calls.filter(([r]) => r.headers?.Authorization === 'Bearer invented-replacement')
    ).toEqual([])
    expect(view.model.screen.title).toBe('')
    expect(view.containerEl.textContent).toMatch(/may not use|access|approval/i)
  })

  it.each(['off', 'ask'] as const)(
    'never uses a %s server-default token for people requested by a tab opened as another account',
    async (mode) => {
      const { agent, view } = setup(mode)
      await view.setState(
        {
          url: 'https://github.com/sample/repo/issues/1',
          connectionId: 'selected',
          connectionIntent: 'manual',
          tree: false,
          allowedConnections: ['selected'],
          executionAgentId: agent.id,
          approvedConnections: [],
        },
        { history: false }
      )
      await view.onOpen()
      await vi.waitFor(() => expect(view.containerEl.textContent).toContain('Sample Author'))
      expect(request.mock.calls.some(([r]) => r.url.endsWith('/graphql'))).toBe(true)
      expect(
        request.mock.calls.every(([r]) => r.headers?.Authorization === 'Bearer invented-selected')
      ).toBe(true)
    }
  )
})
