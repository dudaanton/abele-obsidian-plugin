import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalRaw } from './helpers/obsidianCli'
import {
  startFakeGithub,
  enableGithub,
  restoreGithub,
  evalAsync,
  PRELUDE,
  type FakeGithub,
} from './helpers/githubLive'
import { targets } from './helpers/target'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
describe.skipIf(!available)('execution-agent GitHub connection boundary', () => {
  let gh: FakeGithub
  beforeAll(async () => {
    gh = await startFakeGithub({ mode: 'accounts' })
    enableGithub(gh.origin)
    evalRaw(`(()=>{
      const config=window.__abeleTest.AbeleConfig.getInstance()
      config.github.connections=['one','two'].map((id,i)=>({id,name:'Sample '+id,server:${JSON.stringify(gh.origin)},keyId:'sample-agent-'+id,owners:[],isDefault:i===0}))
      const before=app.secretStorage.getSecret
      app.secretStorage.getSecret=function(id){return id==='sample-agent-one'?'invented-connection-one':id==='sample-agent-two'?'invented-connection-two':before.call(this,id)}
      const registry=window.__abeleTest.AgentRegistry.getInstance()
      window.__connectionAgents=[registry.create({name:'Sample first',githubConnections:{one:'auto',two:'off'}}).id,registry.create({name:'Sample second',githubConnections:{one:'off',two:'auto'}}).id]
      config.version.value++
      return 'ok'
    })()`)
  })
  afterAll(() => {
    try {
      evalRaw(
        `(()=>{const r=window.__abeleTest.AgentRegistry.getInstance();for(const id of window.__connectionAgents||[])r.remove(id);delete window.__connectionAgents;return 'ok'})()`
      )
      restoreGithub()
    } finally {
      gh?.stop()
    }
  })

  it('uses the executing agent, refuses forbidden explicit access, and hides a loaded private tab', async () => {
    const result = evalAsync<{ allowed: string; denied: string; views: string }>(`(async()=>{
      ${PRELUDE}
      const [first,second]=window.__connectionAgents
      const tool=(agentId,name)=>window.__abeleTest.createAgentTools({agentId}).find(t=>t.name===name)
      const params={repo:${JSON.stringify(gh.web + '/blob/main/src/app.ts')},connection:'Sample two'}
      const allowed=JSON.stringify(await tool(second,'github_file').execute('allowed',params))
      let denied=''
      try{await tool(first,'github_file').execute('denied',params)}catch(e){denied=String(e.message)}
      const leaf=await openTab(${JSON.stringify(gh.web + '/issues/7')})
      await leaf.view.setState({url:${JSON.stringify(gh.web + '/issues/7')},connectionId:'two',connectionIntent:'manual'},{history:false})
      await until(()=>leaf.view.model.screen.title,15000)
      const views=JSON.stringify(await tool(first,'github_views').execute('views',{}))
      leaf.detach()
      return {allowed,denied,views}
    })()`)
    expect(result.allowed).toContain('const widgets = loadWidgets(count)')
    expect(result.denied).toMatch(/disabled|access/i)
    expect(result.views).toContain('Restricted GitHub tab')
    expect(result.views).not.toContain('Loader hangs on an empty list')
    expect(JSON.stringify(result)).not.toContain('invented-connection')
    expect(JSON.stringify(result)).not.toContain('sample-agent-two')
  })
})
