import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'
import { githubSettingsFrom } from '@/github/settings'
import { parseForSettings, resolveConnectionCandidates } from '@/github/GithubService'
import { forgejoConnectionSource } from '@/forge/forgejoConnections'
import { sameConnectionServer } from '@/github/connectionRouting'
import { isBrowsableConnection } from '@/github/connections'
import { GithubView } from '@/github/GithubView'
import { WorkspaceLeaf } from 'obsidian'
import {
  repoFromUrl,
  setPinned,
  pinnedRepos,
  rememberRepo,
  recentRepos,
} from '@/github/open/repoList'
import { RepoPicker } from '@/github/open/RepoPicker'
import { OpenPicker, forgetLastPicked, pickerRepo } from '@/github/open/OpenPicker'

const server = 'https://git.example.test/team'
const row = {
  id: 'native',
  provider: 'gitea',
  name: 'Sample Gitea',
  server,
  keyId: '',
  owners: [],
  isDefault: true,
}
beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().github = githubSettingsFrom({ enabled: true, connections: [row] })
})
describe('Gitea credential-bound composition', () => {
  it('keeps a saved GitHub repository context when only native accounts are configured', () => {
    const app = useVault([])
    forgetLastPicked()
    AbeleConfig.getInstance().github.defaultRepo = 'https://github.com/sample/project'
    const view = vi.fn().mockReturnValue({ rows: [], message: 'Legacy repository lookup' })
    const picker = new OpenPicker(app, '', { unasked: () => false, view } as never)
    try { picker.getSuggestions('#12'); expect(view).toHaveBeenCalled(); expect(picker.emptyStateText).toBe('Legacy repository lookup') }
    finally { picker.onClose(); forgetLastPicked() }
  })
  it('does not replace a deleted manually selected picker account with another account', async () => {
    const app = useVault([]),
      target = parseForSettings(`${server}/sample/project`)
    AbeleConfig.getInstance().github.connections = [{ ...row, id: 'replacement' }]
    const leaf = {
      view: {
        getViewType: () => 'abele-github',
        model: { target, connectionId: 'native', connectionIntent: 'manual' },
      },
    }
    Object.assign(app, {
      workspace: { getMostRecentLeaf: () => leaf, getLeavesOfType: () => [leaf] },
    })
    const service = await import('@/github/GithubService'),
      open = vi.spyOn(service, 'openGithubUrl').mockResolvedValue(true)
    const picker = new OpenPicker(app)
    try {
      expect(picker.getSuggestions('#12')).toEqual([])
      expect(picker.emptyStateText).toMatch(/unavailable/i)
      await picker.choose(
        { kind: 'repo', title: 'sample/project', url: `${server}/sample/project` },
        false
      )
      expect(open).toHaveBeenLastCalledWith(
        app,
        `${server}/sample/project`,
        false,
        expect.objectContaining({ sourceId: 'native', sourceIntent: 'manual' })
      )
    } finally {
      picker.onClose()
      open.mockRestore()
      forgetLastPicked()
    }
  })
  it('remembers native picker context alongside GitHub and refuses a removed remembered connection', async () => {
    const app = useVault([])
    AbeleConfig.getInstance().github.connections.push({
      id: 'github',
      name: 'Sample GitHub',
      server: '',
      keyId: '',
      owners: [],
      isDefault: true,
    })
    const service = await import('@/github/GithubService'),
      directory = await import('@/forge/forgejoDirectory')
    const open = vi.spyOn(service, 'openGithubUrl').mockResolvedValue(true)
    const search = vi.spyOn(directory, 'nativeOpenRows').mockResolvedValue([])
    forgetLastPicked()
    vi.useFakeTimers()
    const first = new OpenPicker(app)
    let second: OpenPicker | undefined, removed: OpenPicker | undefined
    try {
      await first.choose(
        { kind: 'repo', title: 'sample/project', url: `${server}/sample/project` },
        false
      )
      expect(pickerRepo(app)).toMatchObject({
        provider: 'gitea',
        origin: server,
        owner: 'sample',
        repo: 'project',
      })
      second = new OpenPicker(app)
      second.getSuggestions('#12')
      await vi.advanceTimersByTimeAsync(1000)
      expect(search).toHaveBeenCalledWith(expect.anything(), 'sample/project', '#12')
      expect(second.getSuggestions('#12')).toEqual([])
      expect(second.emptyStateText).toMatch(/no matching/i)
      second.onClose()
      AbeleConfig.getInstance().github.connections =
        AbeleConfig.getInstance().github.connections.filter((c) => c.id !== 'native')
      removed = new OpenPicker(app)
      expect(removed.getSuggestions('#12')).toEqual([])
      expect(removed.emptyStateText).toMatch(/unavailable/i)
    } finally {
      first.onClose()
      second?.onClose()
      removed?.onClose()
      open.mockRestore()
      search.mockRestore()
      forgetLastPicked()
      vi.useRealTimers()
    }
  })
  it('binds a pasted URL to its own deployment instead of the picker previous account', async () => {
    const app = useVault([]),
      other = 'https://other.example.test/team'
    AbeleConfig.getInstance().github.connections.push({ ...row, id: 'other', server: other })
    const service = await import('@/github/GithubService'),
      open = vi.spyOn(service, 'openGithubUrl').mockResolvedValue(true)
    const picker = new OpenPicker(app)
    try {
      await picker.choose(
        { kind: 'repo', title: 'sample/project', url: `${other}/sample/project` },
        false
      )
      expect(open).toHaveBeenLastCalledWith(
        app,
        `${other}/sample/project`,
        false,
        expect.objectContaining({ sourceId: 'other' })
      )
    } finally {
      picker.onClose()
      open.mockRestore()
      forgetLastPicked()
    }
  })
  it('invalidates an open native picker when its connection is removed', () => {
    const picker = new RepoPicker(useVault([]))
    picker.onOpen()
    try {
      expect(() => {
        AbeleConfig.getInstance().github.connections = []
        AbeleConfig.getInstance().version.value++
      }).not.toThrow()
      expect(picker.getSuggestions('sample')).toEqual([])
    } finally {
      picker.onClose()
    }
  })
  it('offers a typed repository on the configured native deployment', () => {
    const app = useVault([])
    AbeleConfig.getInstance().github = githubSettingsFrom({ enabled: true, connections: [row] })
    const picker = new RepoPicker(app)
    try {
      expect(picker.getSuggestions('sample/project')).toMatchObject([
        { repo: { provider: 'gitea', origin: server, owner: 'sample', repo: 'project' } },
      ])
    } finally {
      picker.onClose()
    }
  })
  it('retains native pinned and recent repository identities across deployment paths', async () => {
    const app = useVault([])
    AbeleConfig.getInstance().github = githubSettingsFrom({ enabled: true, connections: [row] })
    vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
    const repo = repoFromUrl(`${server}/sample/project`)!
    expect(repo).toMatchObject({
      provider: 'gitea',
      origin: server,
      owner: 'sample',
      repo: 'project',
    })
    await setPinned(repo, true)
    rememberRepo(app, repo)
    AbeleConfig.getInstance().github.connections = []
    expect(pinnedRepos()).toMatchObject([
      { provider: 'gitea', origin: server, owner: 'sample', repo: 'project' },
    ])
    expect(recentRepos(app)).toMatchObject([
      { provider: 'gitea', origin: server, owner: 'sample', repo: 'project' },
    ])
  })
  it('routes and restores Gitea without converting its identity to Forgejo or GitHub', async () => {
    expect(isBrowsableConnection(row)).toBe(true)
    const url = `${server}/sample/project/pulls/12`
    const target = parseForSettings(url)!
    expect(target).toMatchObject({ provider: 'gitea', kind: 'pull' })
    expect(resolveConnectionCandidates(target)).toEqual([{ id: 'native', reason: 'default' }])
    expect(sameConnectionServer({ ...row, provider: 'forgejo' }, target)).toBe(false)
    const view = new GithubView(new WorkspaceLeaf())
    await view.setState({ url, connectionId: 'native' }, { history: false })
    expect(view.getState()).toMatchObject({
      sourceTarget: { provider: 'gitea', deployment: { kind: 'gitea' }, connection: 'native' },
    })
  })
  it('reads native metadata and retires a Gitea source when its binding changes', async () => {
    const http = vi.fn(async () => ({
      status: 200,
      headers: {},
      text: '',
      arrayBuffer: new ArrayBuffer(0),
      json: { name: 'project', owner: { login: 'sample' }, default_branch: 'main' },
    }))
    const source = forgejoConnectionSource('native', 'sample/project', http)
    expect(source.identity).toMatchObject({ provider: 'gitea', deployment: { kind: 'gitea' } })
    expect(await source.metadata()).toMatchObject({ name: 'project' })
    expect(http).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${server}/api/v1/repos/sample/project` })
    )
    AbeleConfig.getInstance().github.connections[0].provider = 'forgejo'
    AbeleConfig.getInstance().version.value++
    await expect(source.metadata()).rejects.toThrow(/changed|removed/)
  })
})
