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
import { until } from './helpers/wait'
import { HEAD_SHA, OWNER, REPO } from './helpers/fakeGithubRepo'

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
      window.__connectionSelectedToken='invented-connection-two'
      app.secretStorage.getSecret=function(id){return id==='sample-agent-one'?'invented-connection-one':id==='sample-agent-two'?window.__connectionSelectedToken:before.call(this,id)}
      const registry=window.__abeleTest.AgentRegistry.getInstance()
      window.__connectionAgents=[registry.create({name:'Sample first',githubConnections:{one:'auto',two:'off'}}).id,registry.create({name:'Sample second',githubConnections:{one:'off',two:'auto'}}).id]
      config.version.value++
      return 'ok'
    })()`)
  })
  afterAll(() => {
    try {
      evalRaw(
        `(()=>{const r=window.__abeleTest.AgentRegistry.getInstance();for(const id of window.__connectionAgents||[])r.remove(id);delete window.__connectionAgents;delete window.__connectionSelectedToken;return 'ok'})()`
      )
      restoreGithub()
    } finally {
      gh?.stop()
    }
  })

  it('an implicit read selects the permitted account instead of the Off server default', () => {
    const text=evalAsync<string>(`(async()=>{
      const tool=window.__abeleTest.createAgentTools({agentId:window.__connectionAgents[1]}).find(t=>t.name==='github_read')
      return JSON.stringify(await tool.execute('implicit-read',{item:${JSON.stringify(gh.web+'/issues/7')}}))
    })()`)
    expect(text).toContain('Loader hangs on an empty list')
    expect(text).toContain('Sample two')
  })

  it.each(['off','ask'])('an agent-opened tab never fetches people with its %s server-default connection', async mode => {
    const profileQueries=()=>gh.requests().filter(line=>line.startsWith('POST /api/graphql')).length
    await new Promise(resolve=>setImmediate(resolve))
    const before=profileQueries()
    const shown=evalAsync<boolean>(`(async()=>{
      ${PRELUDE}
      const agent=window.__abeleTest.AgentRegistry.getInstance().get(window.__connectionAgents[1])
      const previous=agent.githubConnections.one
      let leaf
      try {
        agent.githubConnections.one=${JSON.stringify(mode)}
        await window.__abeleTest.githubUsers().clear()
        const tool=window.__abeleTest.createAgentTools({agentId:agent.id}).find(t=>t.name==='github_open')
        await tool.execute('open-profiles',{url:${JSON.stringify(gh.web+'/issues/7')},connection:'Sample two'})
        leaf=githubLeaves()[0]
        return !!(await until(()=>leaf?.view.containerEl.textContent.includes('Bob Example'),15000))
      } finally {leaf?.detach();agent.githubConnections.one=previous}
    })()`)
    expect(shown).toBe(true)
    expect(await until(()=>profileQueries()>before)).toBeTruthy()
    expect(gh.requests().filter(line=>line.includes('account=one'))).toEqual([])
  })

  it('Ask gates the actual execution factory and accepts one operation without changing the mode', async () => {
    const result = evalAsync<{ asked: boolean; mode: string; code: string }>(`(async()=>{
      ${PRELUDE}
      const id=window.__connectionAgents[1]
      const agent=window.__abeleTest.AgentRegistry.getInstance().get(id)
      agent.githubConnections.two='ask'
      const tool=window.__abeleTest.createAgentTools({agentId:id,githubApproval:window.__abeleTest.connectionApproval(app)}).find(t=>t.name==='github_file')
      const pending=tool.execute('ask-once',{repo:${JSON.stringify(gh.web + '/blob/main/src/app.ts')},connection:'Sample two'})
      const button=await until(()=>[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Allow once'),5000)
      const asked=!!button
      button?.click()
      const code=JSON.stringify(await pending)
      const mode=agent.githubConnections.two
      agent.githubConnections.two='auto'
      return {asked,mode,code}
    })()`)
    expect(result.asked).toBe(true)
    expect(result.mode).toBe('ask')
    expect(result.code).toContain('const widgets = loadWidgets(count)')
  })

  it('does not use an old Ask grant when a tool-opened tab receives another account token', async () => {
    const before=gh.requests().filter(line=>line.includes('account=one')).length
    const result=evalAsync<{loaded:boolean;refused:boolean;empty:boolean}>(`(async()=>{
      ${PRELUDE}
      const config=window.__abeleTest.AbeleConfig.getInstance()
      const agent=window.__abeleTest.AgentRegistry.getInstance().get(window.__connectionAgents[1])
      const previous=agent.githubConnections.two
      let leaf
      try {
        agent.githubConnections.two='ask'
        const tool=window.__abeleTest.createAgentTools({agentId:agent.id,githubApproval:window.__abeleTest.connectionApproval(app)}).find(t=>t.name==='github_open')
        const pending=tool.execute('open-with-grant',{url:${JSON.stringify(gh.web+'/issues/7')},connection:'Sample two'})
        const approve=await until(()=>[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Allow once'),5000)
        if(!approve) throw new Error('The connection approval did not open')
        approve.click();await pending
        leaf=githubLeaves()[0]
        const loaded=!!(await until(()=>leaf?.view.model.screen.title,15000))
        window.__connectionSelectedToken='invented-connection-one'
        config.version.value++
        const refused=!!(await until(()=>/may not use|access|approval/i.test(leaf.view.model.screen.error),10000))
        return {loaded,refused,empty:leaf.view.model.screen.title===''}
      } finally {
        leaf?.detach();window.__connectionSelectedToken='invented-connection-two'
        agent.githubConnections.two=previous;config.version.value++
      }
    })()`)
    expect(result).toEqual({loaded:true,refused:true,empty:true})
    // Yield through the request-log stream after the app has settled the refused load.
    await new Promise(resolve=>setImmediate(resolve))
    expect(gh.requests().filter(line=>line.includes('account=one'))).toHaveLength(before)
  })

  it('falls back for a commit even when the first account can read repository metadata', () => {
    const text=evalAsync<string>(`(async()=>{
      const config=window.__abeleTest.AbeleConfig.getInstance()
      const agent=window.__abeleTest.AgentRegistry.getInstance().get(window.__connectionAgents[0])
      const previous=agent.githubConnections.two, owners=config.github.connections[0].owners
      try {
        agent.githubConnections.two='auto'
        config.github.connections[0].owners=[${JSON.stringify(OWNER+'/'+REPO)}]
        const tool=window.__abeleTest.createAgentTools({agentId:agent.id}).find(t=>t.name==='github_commits')
        return JSON.stringify(await tool.execute('commit-scope',{repo:${JSON.stringify(gh.web)},sha:${JSON.stringify(HEAD_SHA)}}))
      } finally {agent.githubConnections.two=previous;config.github.connections[0].owners=owners}
    })()`)
    expect(text).toContain('Sample two')
    expect(text).toContain(HEAD_SHA.slice(0,7))
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
