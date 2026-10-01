import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceLeaf, type App } from 'obsidian'
import { GithubView } from '@/github/GithubView'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { githubSettingsFrom } from '@/github/settings'
import { GithubUsers, setGithubUsers } from '@/github/users'
import { useVault } from '../helpers/testEnv'

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
  Object.assign(app, { workspace: { requestSaveLayout: vi.fn(), getLeavesOfType: () => [leaf] } })
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
  return { app, agent, view }
}

describe('an agent-opened tab capability', () => {
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
