import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalRaw } from './helpers/obsidianCli'
import { startFakeGithub, enableGithub, restoreGithub, evalAsync, PRELUDE, type FakeGithub } from './helpers/githubLive'
import { targets } from './helpers/target'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('connection-aware GitHub tabs', () => {
  let gh: FakeGithub
  beforeAll(async () => {
    gh = await startFakeGithub({mode:'accounts'})
    enableGithub(gh.origin)
    evalRaw(`(() => {
      const config = window.__abeleTest.AbeleConfig.getInstance()
      config.github.connections = ['one','two'].map((id,i)=>({id,name:'Sample '+id,server:${JSON.stringify(gh.origin)},keyId:'sample-tab-'+id,owners:[],isDefault:i===0,account:{login:'sample-account-'+id}}))
      const before = app.secretStorage.getSecret
      app.secretStorage.getSecret = function(id){ return id==='sample-tab-one' ? 'invented-connection-one' : id==='sample-tab-two' ? 'invented-connection-two' : before.call(this,id) }
      config.version.value++
      return 'ok'
    })()`)
  })
  afterAll(() => { try {restoreGithub()} finally {gh?.stop()} })

  it('falls back to the account that can read the primary item, then preserves manual refusal and history', () => {
    const r = evalAsync<{id?:string;notice?:string;history?:boolean;cleared?:boolean;denied?:boolean;state?:unknown}>(`(async()=>{
      ${PRELUDE}
      const leaf = await openTab(${JSON.stringify(gh.web + '/issues/7')})
      const found = await until(()=>leaf.view.model.connectionId === 'two' && leaf.view.model.screen.title,20000)
      if (!found) return {notice:leaf.view.containerEl.textContent}
      const report = {id:leaf.view.model.connectionId,notice:leaf.view.model.connectionNotice}
      const before = leaf.view.model.screen.title
      const history = {history:false}
      await leaf.view.setState({url:${JSON.stringify(gh.web + '/issues/7')},connectionId:'one',connectionIntent:'manual'},history)
      report.history = history.history
      report.cleared = !leaf.view.model.screen.title && !JSON.stringify(leaf.view.model.screen).includes(before)
      const denied = await until(()=>leaf.view.containerEl.querySelector('.abele-github__error'),10000)
      report.denied = !!denied && leaf.view.model.connectionId === 'one'
      report.state = leaf.view.getState()
      leaf.detach()
      return report
    })()`)
    expect(r.id).toBe('two')
    expect(r.notice).toContain('Opened as Sample two')
    expect(r.history).toBe(true)
    expect(r.cleared).toBe(true)
    expect(r.denied).toBe(true)
    expect(r.state).toMatchObject({connectionId:'one',connectionIntent:'manual'})
  })
})
