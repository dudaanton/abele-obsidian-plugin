import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { isObsidianRunning, hasTestApi } from './helpers/obsidianCli'
import { evalAsync, startFakeGithub, type FakeGithub, PRELUDE } from './helpers/githubLive'
import { targets, onPhone } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('abele-github-connections')

describe.skipIf(!available)(
  'GitHub connection editor against independent invented credentials',
  () => {
    let server: FakeGithub
    beforeAll(async () => {
      server = await startFakeGithub({ mode: 'accounts' })
    })
    afterAll(() => server?.stop())
    const closeDialogs = () =>
      evalAsync(`(async () => {
    ${PRELUDE}
    for (let i=0;i<8 && document.querySelector('.modal');i++) {
      document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}))
      await wait(150)
    }
    return !document.querySelector('.modal')
  })()`)
    beforeEach(() => {
      expect(closeDialogs()).toBe(true)
    })
    afterEach(() => {
      closeDialogs()
    })

    it('keeps imported provider rows quiet and removable beside working GitHub controls', () => {
      const result = evalAsync<{
        unavailable: boolean
        actions: string[]
        githubEditable: boolean
        removed: boolean
        retained: boolean
        shots: string[]
      }>(`(async () => {
        ${PRELUDE}
        window.__abeleTest.openDialog('github-connections')
        const root = await until(() => document.querySelector('.abele-settings__github'))
        if (!root) throw Error('Connection settings did not open')
        const config = window.__abeleTest.AbeleConfig.getInstance()
        const github = {...config.github.connections[0], name:'Sample GitHub'}
        config.github.connections = [github, {...github, id:'sample-forgejo', provider:'forgejo', name:'Sample Forgejo', server:'https://git.example.test/team', keyId:''}]
        config.version.value++
        const row = await until(() => [...root.querySelectorAll('.setting-item')].find(el => el.querySelector('.setting-item-name')?.textContent.trim() === 'Sample Forgejo'))
        if (!row) throw Error('Imported connection row did not render')
        const actions = [...row.querySelectorAll('button')].map(button => button.textContent.trim())
        const unavailable = row.textContent.includes('Forgejo, available in a later version')
        const githubRow = [...root.querySelectorAll('.setting-item')].find(el => el.querySelector('.setting-item-name')?.textContent.startsWith('Sample GitHub'))
        const githubEditable = [...githubRow.querySelectorAll('button')].some(button => button.textContent.trim() === 'Edit')
        const paths = []
        const shoot = async path => {
          if (window.__e2eHost) return window.__e2eHost.shot(path)
          const image = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
          if (!image) throw Error('Connection settings screenshot did not arrive')
          require('fs').writeFileSync(path,image.toPNG())
          return path
        }
        row.scrollIntoView({block:'center'}); await wait(200)
        paths.push(await shoot(${JSON.stringify(shots + '/unavailable-provider-desktop.png')}))
        if (!${JSON.stringify(onPhone())}) {
          const win = require('@electron/remote').getCurrentWindow()
          const size = win.getContentSize(), phone = document.body.classList.contains('is-phone')
          try {
            win.setContentSize(390,844); document.body.classList.add('is-phone')
            await wait(300); row.scrollIntoView({block:'center'}); await wait(200)
            paths.push(await shoot(${JSON.stringify(shots + '/unavailable-provider-phone.png')}))
          } finally {win.setContentSize(...size);document.body.classList.toggle('is-phone',phone)}
        }
        row.querySelector('button')?.click()
        const confirmation = await until(() => [...document.querySelectorAll('.modal')].find(modal => modal.textContent.includes('Delete Sample Forgejo?')))
        if (!confirmation) throw Error('Connection deletion did not ask for confirmation')
        const remove = [...confirmation.querySelectorAll('button')].find(button => button.textContent.trim() === 'Delete')
        if (!remove) throw Error('Connection deletion has no confirm action')
        remove.click()
        const removed = !!(await until(() => !config.github.connections.some(c => c.id === 'sample-forgejo')))
        return {unavailable,actions,githubEditable,removed,retained:config.github.connections.some(c => c.id === github.id),shots:paths}
      })()`)
      expect(result).toMatchObject({
        unavailable: true,
        actions: ['Delete'],
        githubEditable: true,
        removed: true,
        retained: true,
      })
      expect(result.shots.length).toBeGreaterThan(0)
    })

    it('checks two unsaved credentials against their own account and never renders or stores them', async () => {
      const result = evalAsync<{
        accounts: string[]
        exposed: boolean
        unchanged: boolean
      }>(`(async () => {
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
      const result = evalAsync<{
        overflow: number
        footer: number
        viewport: number
        shots: string[]
      }>(`(async () => {
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
  }
)
