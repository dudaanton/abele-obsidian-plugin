import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RefPicker } from '@/github/repoPage/RefPicker'
import { mount, flushPromises } from '@vue/test-utils'
import { computed, reactive } from 'vue'
import GithubUser from '@/components/github/GithubUser.vue'
import { githubUsers } from '@/github/users'
import { REPOSITORY_SOURCE } from '@/repository/context'
import type { RepositorySource } from '@/repository/source'
import { WorkspaceLeaf, Menu } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'
import { githubSettingsFrom } from '@/github/settings'
import { GithubView } from '@/github/GithubView'
import GithubItem from '@/components/github/GithubItem.vue'
import { emptyScreen } from '@/github/screen'
import { parseForSettings } from '@/github/GithubService'
import { forgejoRepository } from '@/forge/forgejoRepository'
import { ForgejoClient } from '@/forge/forgejoClient'
import { deployment } from '@/forge/identity'
import type { GithubViewModel } from '@/github/model'

const base = 'https://forge.example.test/team'
beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().github = githubSettingsFrom({
    enabled: true,
    connections: ['one', 'two'].map((id) => ({
      id,
      provider: 'forgejo',
      name: id,
      server: base,
      keyId: '',
      owners: [],
      isDefault: id === 'one',
    })),
  })
})
describe('Forgejo approved repository views', () => {
  it('renders native lists and loads filters from the selected repository source', async () => {
    const client = new ForgejoClient(
      deployment('forgejo', base),
      { connectionId: 'one', generation: 'sample', assertCurrent() {} },
      async () => ({
        status: 200,
        headers: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
        json: [{ number: 1, title: 'Sample list row', state: 'open' }],
      }),
      ''
    )
    const source = forgejoRepository(client, 'sample/project')
    const choices = vi
      .fn()
      .mockResolvedValue({ labels: ['sample-label'], milestones: [], categories: [] })
    source.github!.listChoices = choices
    const url = `${base}/sample/project/issues`
    const model = reactive<GithubViewModel>({
      url,
      target: parseForSettings(url),
      nonce: 0,
      screen: emptyScreen(),
      tree: false,
    })
    const view = mount(GithubItem, { props: { model, enabled: true, source } })
    try {
      await flushPromises()
      expect(view.text()).toContain('Sample list row')
      expect(choices).toHaveBeenCalledOnce()
      expect(view.text()).toContain('sample-label')
    } finally {
      view.unmount()
    }
  })
  it('offers the shared comparison base picker for a native file', async () => {
    const sha = 'a'.repeat(40)
    const client = new ForgejoClient(
      deployment('forgejo', base),
      {
        connectionId: 'one',
        generation: 'sample',
        assertCurrent() {},
      },
      async () => ({
        status: 200,
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
        text: '',
        json: {
          type: 'file',
          encoding: 'base64',
          content: btoa('sample\n'),
          sha,
        },
      }),
      ''
    )
    const url = `${base}/sample/project/src/commit/${sha}/sample.ts`
    const model = reactive<GithubViewModel>({
      url,
      target: parseForSettings(url),
      nonce: 0,
      screen: emptyScreen(),
      tree: false,
    })
    const view = mount(GithubItem, {
      props: { model, enabled: true, source: forgejoRepository(client, 'sample/project') },
    })
    try {
      await flushPromises()
      expect(view.find('[aria-label="Compare against a branch, tag or commit…"]').exists()).toBe(
        true
      )
    } finally {
      view.unmount()
    }
  })
  it('does not retain a credential-bearing imported repository URL', async () => {
    const view = new GithubView(new WorkspaceLeaf())
    await view.setState(
      {
        sourceTarget: {
          version: 1,
          provider: 'forgejo',
          connection: 'two',
          deployment: deployment('forgejo', base),
          repository: 'sample/project',
          url: `${base}/sample/project?access_token=sample-secret`,
        },
      },
      { history: false }
    )
    expect(view.getState().url).toBe('')
    expect(view.model.screen.error).toMatch(/invalid/i)
  })
  it('does not reuse a GitHub profile cache entry for a Forgejo login', () => {
    const cache = vi.spyOn(githubUsers(), 'person').mockReturnValue({
      login: 'sample-user',
      name: 'Cached profile on another service',
      avatar: null,
    })
    const source = { identity: { provider: 'forgejo' } } as RepositorySource
    const view = mount(GithubUser, {
      props: { login: 'sample-user' },
      global: { provide: { [REPOSITORY_SOURCE as symbol]: computed(() => source) } },
    })
    try {
      expect(view.text()).toBe('sample-user')
      expect(cache).not.toHaveBeenCalled()
    } finally {
      view.unmount()
      cache.mockRestore()
    }
  })
  it('preserves whether a same-name reference choice is a branch or a tag', () => {
    const app = useVault([]),
      choose = vi.fn()
    const picker = new RefPicker(
      app,
      { identity: { provider: 'forgejo' }, navigation: { ref: () => '' } } as never,
      { host: 'forge.example.test', owner: 'sample', repo: 'project' },
      'main',
      'main',
      choose
    )
    picker.onChooseSuggestion({ kind: 'tag', name: 'shared' })
    expect(choose).toHaveBeenCalledWith('shared', 'tag')
    picker.onClose()
  })
  it('does not replace a deleted saved account with another credential', async () => {
    const first = new GithubView(new WorkspaceLeaf())
    await first.setState(
      { url: `${base}/sample/project/pulls/12`, connectionId: 'two' },
      { history: false }
    )
    const saved = first.getState()
    AbeleConfig.getInstance().github.connections =
      AbeleConfig.getInstance().github.connections.filter((r) => r.id !== 'two')
    const restored = new GithubView(new WorkspaceLeaf())
    await restored.setState(saved, { history: false })
    expect(restored.model.connectionId).toBe('two')
    expect(restored.model.screen.error).toMatch(/removed|choose.*connection/i)
    AbeleConfig.getInstance().github.connections = []
    const unavailable = new GithubView(new WorkspaceLeaf())
    await unavailable.setState(saved, { history: false })
    expect(unavailable.model.target).toMatchObject({ provider: 'forgejo', kind: 'pull' })
    expect(unavailable.model.screen.error).toMatch(/removed|choose.*connection/i)
  })
  it('restores provider state and offers accounts on precisely the same deployment', async () => {
    const view = new GithubView(new WorkspaceLeaf())
    await view.setState(
      { url: `${base}/sample/project/pulls/12`, connectionId: 'two' },
      { history: false }
    )
    expect(view.model.target?.kind).toBe('pull')
    expect(view.getState()).toMatchObject({
      sourceTarget: {
        version: 1,
        provider: 'forgejo',
        connection: 'two',
        repository: 'sample/project',
      },
    })
    const menu = new Menu()
    view.fillQuickMenu(menu)
    expect(menu.items.map((i) => i.title)).toContain('Open as one')
  })
  it.each([false, true])(
    'renders a PR with unknown counts and native conversation without any GitHub client (partial: %s)',
    async (partial) => {
      const client = new ForgejoClient(
        deployment('forgejo', base),
        { connectionId: 'one', generation: 'sample', assertCurrent() {} },
        async (request) => {
          if (partial && /comments|reviews/.test(request.url))
            throw new Error('Sample secondary refusal')
          const json = request.url.endsWith('/pulls/12')
            ? {
                number: 12,
                title: 'Sample change',
                body: 'Sample body',
                state: 'open',
                created_at: '',
                user: null,
                base: { ref: 'main', sha: 'a'.repeat(40) },
                head: { ref: 'topic', sha: 'b'.repeat(40) },
              }
            : []
          return {
            status: 200,
            headers: {},
            json,
            text: JSON.stringify(json),
            arrayBuffer: new ArrayBuffer(0),
          }
        },
        ''
      )
      const model = reactive<GithubViewModel>({
        url: `${base}/sample/project/pulls/12`,
        target: parseForSettings(`${base}/sample/project/pulls/12`),
        nonce: 0,
        screen: emptyScreen(),
        tree: false,
      })
      const view = mount(GithubItem, {
        props: { model, enabled: true, source: forgejoRepository(client, 'sample/project') },
      })
      await flushPromises()
      expect(view.text()).toContain('Sample change')
      expect(view.text()).not.toContain('null')
      expect(view.text()).not.toContain('+0')
      if (partial) {
        expect(view.text()).toContain('could not be read')
        expect(view.text()).not.toContain('Only the first 0 comments')
      }
      view.unmount()
    }
  )
})
