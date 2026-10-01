import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { githubSettingsFrom } from '@/github/settings'
import { readConnectionItem } from '@/github/connectionRead'
import { GithubError } from '@/github/client'
import { emptyScreen } from '@/github/screen'
import { useVault } from '../helpers/testEnv'
const stubs = vi.hoisted(() => ({ load:vi.fn(), request:vi.fn() }))
vi.mock('@/github/loadItem', () => ({ loadItem:stubs.load }))
vi.mock('@/github/transport', () => ({ singleHopRequest:stubs.request }))
beforeEach(() => { stubs.load.mockReset(); stubs.request.mockReset() })

describe('fallback only on the primary item', () => {
  it('does not switch accounts for a failure after the primary access check succeeds', async () => {
    const app = useVault([])
    const config = AbeleConfig.getInstance()
    config.github = githubSettingsFrom({ enabled:true, connections:['first','second'].map((id,i)=>({id,name:id,server:'',keyId:`${id}-primary`,owners:[],isDefault:i===0})) })
    for (const c of config.github.connections) app.secretStorage.setSecret(c.keyId,`invented-${c.id}`)
    stubs.request.mockResolvedValue({status:200,headers:{},json:{number:987},text:'',arrayBuffer:new ArrayBuffer(0)})
    stubs.load.mockRejectedValue(new GithubError('forbidden','Secondary endpoint denied',403))
    const target = {kind:'issue' as const,host:'github.com',owner:'sample',repo:'primary-test',number:987}
    await expect(readConnectionItem({url:'https://github.com/sample/primary-test/issues/987',connectionId:'first',nonce:0,target,screen:emptyScreen()},target)).rejects.toThrow('Secondary endpoint denied')
    expect(stubs.load).toHaveBeenCalledOnce()
    expect(stubs.request).toHaveBeenCalledOnce()
  })
})
