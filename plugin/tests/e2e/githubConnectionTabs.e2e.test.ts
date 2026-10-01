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
import { targets, onPhone } from './helpers/target'
import { shotDir } from './helpers/shots'
const SHOTS = shotDir('abele-github-connections')

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('connection-aware GitHub tabs', () => {
  let gh: FakeGithub
  beforeAll(async () => {
    gh = await startFakeGithub({ mode: 'accounts' })
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
  afterAll(() => {
    try {
      restoreGithub()
    } finally {
      gh?.stop()
    }
  })

  it('keeps a long account label and fallback notice inside the real phone viewport', () => {
    if (!onPhone()) return // Desktop phone emulation is covered by githubPhone and phoneLayout.
    const r = evalAsync<{ over: string[]; shot: string; menuOpened: boolean }>(`(async()=>{
      ${PRELUDE}
      const config=window.__abeleTest.AbeleConfig.getInstance()
      const connections=config.github.connections
      let leaf
      try {
        // Separate identities keep this layout probe out of the routing-memory assertion below.
        config.github.connections=connections.map(c=>({...c,id:'layout-'+c.id,name:c.name+' with a long descriptive account label that wraps on a phone'}))
        config.version.value++
        leaf=await openTab(${JSON.stringify(gh.web + '/issues/7')})
        await until(()=>leaf.view.model.screen.title,15000)
        const root=leaf.view.containerEl.querySelector('.abele-github')
        let previous=''
        if (!(await until(()=>{
          if (!root?.isConnected || !root.clientHeight) return false
          const box=root.getBoundingClientRect(), current=[box.x,box.y,box.width,box.height,root.scrollHeight].join(',')
          const stable=current===previous;previous=current;return stable
        }))) throw new Error('The account header did not reach a stable layout')
        const edge=root.getBoundingClientRect()
        const over=[...root.querySelectorAll('button,.abele-empty-state')].filter(el=>{
          const r=el.getBoundingClientRect()
          return r.width>0 && (r.right>Math.min(edge.right,innerWidth)+1 || el.scrollWidth>el.clientWidth+1)
        }).map(el=>el.className)
        const shot=await window.__e2eHost.shot(${JSON.stringify(SHOTS + '/account-header.png')})
        root.querySelector('button.abele-obsidian-button').click()
        const menuOpened=!!(await until(()=>[...document.querySelectorAll('.menu-item-title')].some(el=>el.textContent.startsWith('Open as Sample')),5000))
        document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}))
        return {over,shot,menuOpened}
      } finally {
        leaf?.detach()
        config.github.connections=connections
        config.version.value++
      }
    })()`)
    console.info('account header screenshot', r.shot)
    expect(r.over).toEqual([])
    expect(r.menuOpened).toBe(true)
    expect(r.shot).toMatch(/\.png$/)
  })

  it('falls back to the account that can read the primary item, then preserves manual refusal and history', () => {
    const r = evalAsync<{
      id?: string
      notice?: string
      history?: boolean
      cleared?: boolean
      denied?: boolean
      state?: unknown
    }>(`(async()=>{
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
    expect(r.state).toMatchObject({ connectionId: 'one', connectionIntent: 'manual' })
  })
})
