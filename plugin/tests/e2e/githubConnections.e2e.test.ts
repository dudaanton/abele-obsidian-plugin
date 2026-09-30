import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { isObsidianRunning, hasTestApi } from './helpers/obsidianCli'
import { evalAsync, startFakeGithub, type FakeGithub, PRELUDE } from './helpers/githubLive'
import { targets, onPhone } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('abele-github-connections')

describe.skipIf(!available)('GitHub connection editor against independent invented credentials', () => {
  let server: FakeGithub
  beforeAll(async () => { server = await startFakeGithub({ mode: 'accounts' }) })
  afterAll(() => server?.stop())
  const closeDialogs = () => evalAsync(`(async () => {
    ${PRELUDE}
    for (let i=0;i<8 && document.querySelector('.modal');i++) {
      document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}))
      await wait(150)
    }
    return !document.querySelector('.modal')
  })()`)
  beforeEach(() => { expect(closeDialogs()).toBe(true) })
  afterEach(() => { closeDialogs() })

  it('checks two unsaved credentials against their own account and never renders or stores them', async () => {
    const result = evalAsync<{ accounts: string[]; exposed: boolean; unchanged: boolean }>(`(async () => {
      ${PRELUDE}
      const config = window.__abeleTest.AbeleConfig.getInstance()
      const before = JSON.stringify(config.github)
      const accounts = []
      let exposed = false
      for (const [token, expected] of [['invented-connection-one','sample-account-one'], ['invented-connection-two','sample-account-two']]) {
        window.__abeleTest.openDialog('github-connection')
        const modal = await until(() => document.querySelector('input[placeholder="github_pat_..."]')?.closest('.modal.abele-modal'))
        const set = (placeholder, value) => {
          const field = [...modal.querySelectorAll('input')].find(i => i.placeholder === placeholder)
          field.value = value; field.dispatchEvent(new Event('input', {bubbles:true}))
        }
        set('github.com', ${JSON.stringify(server.origin)})
        set('github_pat_...', token)
        await wait(100)
        const check = [...modal.querySelectorAll('button')].find(b => b.textContent.trim() === 'Check access')
        check.click()
        const report = await until(() => modal.querySelector('.abele-github-access'))
        accounts.push(report?.textContent.includes(expected) ? expected : report?.textContent || 'no report')
        exposed ||= modal.textContent.includes(token)
        const cancel = [...modal.querySelectorAll('button')].find(b => b.textContent.trim() === 'Cancel')
        cancel.click()
        await wait(100)
      }
      return {accounts, exposed, unchanged:JSON.stringify(config.github) === before}
    })()`)
    expect(result.accounts).toEqual(['sample-account-one', 'sample-account-two'])
    expect(result.exposed).toBe(false)
    expect(result.unchanged).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(server.requests().filter((r) => r.includes('/api/v3/user')).length).toBe(2)
  })

  it('keeps the long connection list and editor controls inside the phone screen', async () => {
    if (!onPhone()) return // 390x844 desktop emulation is covered by phoneLayout.
    const result = evalAsync<{ overflow: number; footer: number; viewport: number; shots: string[] }>(`(async () => {
      ${PRELUDE}
      const paths = []
      window.__abeleTest.openDialog('github-connections')
      let modal = await until(() => document.querySelector('.abele-settings__github .abele-section__heading')?.closest('.modal.abele-modal'))
      const heading = [...modal.querySelectorAll('.abele-section__heading')].find(e=>e.textContent==='Connections')
      heading.scrollIntoView({block:'start'})
      await wait(300)
      paths.push(await window.__e2eHost.shot(${JSON.stringify(shots + '/list.png')}))
      const edit = [...modal.querySelectorAll('button')].find(b=>b.textContent.trim()==='Edit')
      edit.scrollIntoView({block:'center'}); edit.click()
      modal = await until(() => document.querySelector('input[type=password][placeholder="github_pat_..."]')?.closest('.modal.abele-modal'))
      const token = modal.querySelector('input[type=password]')
      token.scrollIntoView({block:'center'})
      await wait(300)
      const box = token.getBoundingClientRect()
      await window.__e2eHost.tap(box.left+20,box.top+box.height/2)
      await window.__e2eHost.type('invented-ui-token')
      await wait(500)
      paths.push(await window.__e2eHost.shot(${JSON.stringify(shots + '/token-keyboard.png')}))
      const footer = modal.querySelector('.abele-modal__footer').getBoundingClientRect().bottom
      const overflow = modal.scrollWidth - modal.clientWidth
      const cancel = [...modal.querySelectorAll('button')].find(b=>b.textContent.trim()==='Cancel')
      cancel.click(); await wait(200)
      document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}))
      return {overflow, footer, viewport:innerHeight, shots:paths}
    })()`)
    console.info('connection phone pictures', result.shots)
    expect(result.overflow).toBeLessThanOrEqual(1)
    expect(result.footer).toBeLessThanOrEqual(result.viewport)
    expect(result.shots.every((path) => path.endsWith('.png'))).toBe(true)
  })
})
