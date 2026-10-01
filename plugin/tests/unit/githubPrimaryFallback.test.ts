import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { githubSettingsFrom } from '@/github/settings'
import { readConnectionItem } from '@/github/connectionRead'
import { GithubError } from '@/github/client'
import { emptyScreen } from '@/github/screen'
import { useVault } from '../helpers/testEnv'
const stubs = vi.hoisted(() => ({ load: vi.fn(), request: vi.fn() }))
vi.mock('@/github/loadItem', () => ({ loadItem: stubs.load }))
vi.mock('@/github/transport', () => ({ singleHopRequest: stubs.request }))
beforeEach(() => {
  stubs.load.mockReset()
  stubs.request.mockReset()
})

describe('fallback only on the primary item', () => {
  it('checks the pull request primary endpoint when an issue URL promotes to a pull request', async () => {
    const app=useVault([]), config=AbeleConfig.getInstance()
    config.github=githubSettingsFrom({enabled:true,connections:['issue-first','pull-second'].map((id,i)=>({id,name:id,server:'',keyId:`${id}-key`,owners:[],isDefault:i===0}))})
    for(const c of config.github.connections) app.secretStorage.setSecret(c.keyId,`invented-${c.id}`)
    stubs.request.mockImplementation(async r=>({
      status:r.url.includes('/pulls/') && r.headers.Authorization==='Bearer invented-issue-first' ? 403 : 200,
      headers:{},json:r.url.includes('/issues/') ? {pull_request:{}} : {number:3},text:'',arrayBuffer:new ArrayBuffer(0),
    }))
    stubs.load.mockResolvedValue({title:'Sample pull request'})
    const target={kind:'issue' as const,host:'github.com',owner:'sample',repo:'promotion',number:3}
    const result=await readConnectionItem({url:'https://github.com/sample/promotion/issues/3',connectionId:'issue-first',nonce:0,target,screen:emptyScreen()},target)
    expect(result.connectionId).toBe('pull-second')
    expect(stubs.load).toHaveBeenCalledOnce()
  })

  it('does not send the repository to a fallback connection whose server changed during the first probe', async () => {
    const app = useVault([]),
      config = AbeleConfig.getInstance()
    config.github = githubSettingsFrom({
      enabled: true,
      connections: ['first-race', 'second-race'].map((id, i) => ({
        id,
        name: id,
        server: '',
        keyId: `${id}-key`,
        owners: [],
        isDefault: i === 0,
      })),
    })
    for (const c of config.github.connections)
      app.secretStorage.setSecret(c.keyId, `invented-${c.id}`)
    let finish!: (value: unknown) => void
    stubs.request
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValue({
        status: 200,
        headers: {},
        json: {},
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      })
    stubs.load.mockResolvedValue({ title: 'Sample' })
    const target = {
      kind: 'issue' as const,
      host: 'github.com',
      owner: 'sample',
      repo: 'server-race',
      number: 1,
    }
    const pending = readConnectionItem(
      {
        url: 'https://github.com/sample/server-race/issues/1',
        connectionId: 'first-race',
        nonce: 0,
        target,
        screen: emptyScreen(),
      },
      target
    )
    await vi.waitFor(() => expect(stubs.request).toHaveBeenCalledOnce())
    config.github.connections[1].server = 'https://changed.example.test'
    finish({
      status: 404,
      headers: {},
      json: { message: 'Not found' },
      text: '',
      arrayBuffer: new ArrayBuffer(0),
    })
    await expect(pending).rejects.toThrow(/changed|connection/i)
    expect(stubs.request.mock.calls.some(([r]) => r.url.includes('changed.example.test'))).toBe(
      false
    )
  })

  it('does not switch accounts for a failure after the primary access check succeeds', async () => {
    const app = useVault([])
    const config = AbeleConfig.getInstance()
    config.github = githubSettingsFrom({
      enabled: true,
      connections: ['first', 'second'].map((id, i) => ({
        id,
        name: id,
        server: '',
        keyId: `${id}-primary`,
        owners: [],
        isDefault: i === 0,
      })),
    })
    for (const c of config.github.connections)
      app.secretStorage.setSecret(c.keyId, `invented-${c.id}`)
    stubs.request.mockResolvedValue({
      status: 200,
      headers: {},
      json: { number: 987 },
      text: '',
      arrayBuffer: new ArrayBuffer(0),
    })
    stubs.load.mockRejectedValue(new GithubError('forbidden', 'Secondary endpoint denied', 403))
    const target = {
      kind: 'issue' as const,
      host: 'github.com',
      owner: 'sample',
      repo: 'primary-test',
      number: 987,
    }
    await expect(
      readConnectionItem(
        {
          url: 'https://github.com/sample/primary-test/issues/987',
          connectionId: 'first',
          nonce: 0,
          target,
          screen: emptyScreen(),
        },
        target
      )
    ).rejects.toThrow('Secondary endpoint denied')
    expect(stubs.load).toHaveBeenCalledOnce()
    expect(stubs.request).toHaveBeenCalledOnce()
  })
})
