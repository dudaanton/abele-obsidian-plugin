import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync } from 'node:fs'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'
import {
  startFakeGithub,
  enableGithub,
  restoreGithub,
  evalAsync,
  PRELUDE,
  type FakeGithub,
} from './helpers/githubLive'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { HEAD_SHA, OWNER, REPO, PULL, ISSUE, TAG } from './helpers/fakeGithubRepo'

const shots = shotDir('abele-forgejo')
const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('Forgejo repository slice against a local native API', () => {
  let server: FakeGithub
  beforeAll(async () => {
    server = await startFakeGithub({ mode: 'forgejo' })
    mkdirSync(shots, { recursive: true })
  })
  afterAll(() => server?.stop())

  const enable = () => {
    enableGithub(server.origin)
    evalRaw(`(() => {
      const config = window.__abeleTest.AbeleConfig.getInstance()
      const before = app.secretStorage.getSecret
      app.secretStorage.getSecret = function(id) {
        return id === 'sample-forgejo-one' ? 'invented-connection-one' : id === 'sample-forgejo-two' ? 'invented-connection-two' : before.call(this,id)
      }
      config.github.connections = ['one','two'].map((id,i) => ({ id, provider:'forgejo', name:'Sample Forgejo '+id, server:${JSON.stringify(server.origin + '/forge')}, keyId:'sample-forgejo-'+id, owners:[], isDefault:i===0, account:{login:'sample-account-'+id} }))
      config.version.value++
      return 'ok'
    })()`)
  }
  const closeDialogs = () =>
    evalAsync(`(async () => { ${PRELUDE}
    for (let i=0; i<6 && document.querySelector('.modal'); i++) {
      document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true})); await wait(150)
    }
    return !document.querySelector('.modal')
  })()`)

  for (const layout of ['desktop', 'phone'] as const) {
    it(`reads public and private repositories, conversations, patches and refs in ${layout}`, async () => {
      const probe = async () => {
        enable()
        try {
          const result = evalAsync<{
            states: string[]
            sideways: number
            account: string
            nativeLink: string
            patch: boolean
          }>(
            `(async () => {
            ${PRELUDE}
            const states = [], paths = []
            let largestSideways = 0
            const shoot = async (name, root) => {
              await wait(250)
              if (root) {
                const scroll = root.querySelector('.view-content')
                if (scroll) scroll.scrollTop = 0
              }
              await wait(150)
              const current = root || leaf?.view.containerEl
              const viewport = current?.querySelector('.view-content')
              if (viewport) largestSideways = Math.max(largestSideways, viewport.scrollWidth - viewport.clientWidth)
              const image = await require('@electron/remote').getCurrentWebContents().capturePage()
              const path = ${JSON.stringify(shots + '/' + layout + '-')} + name + '.png'
              require('fs').writeFileSync(path,image.toPNG()); paths.push(path); states.push(name)
            }
            let leaf
            const open = async (suffix, connection = 'two') => {
              if (!leaf) leaf = app.workspace.getLeaf('tab')
              await leaf.setViewState({type:'abele-github',active:true,state:{url:${JSON.stringify(server.origin + '/forge/' + OWNER + '/')}+suffix,connectionId:connection,connectionIntent:'manual',tree:false}})
              const root = leaf.view.containerEl
              if (!(await until(() => root.querySelector('.abele-github-header') && !root.textContent.includes('Loading from Forgejo') && (root.querySelector('.abele-github-home') || root.querySelector('.abele-github-thread') || root.querySelector('.abele-github-files') || root.querySelector('.abele-github-commits') || root.querySelector('.abele-github-blob') || root.querySelector('.abele-github-folder') || root.querySelector('.abele-github-notice')))))
                throw Error('Forgejo view did not finish: '+root.textContent.slice(0,1000))
              return root
            }
            let root = await open(${JSON.stringify(REPO)})
            if (!(await until(() => root.querySelector('.abele-github-folder__readme h1')))) throw Error('README missing')
            await shoot('public-home',root)
            const config = window.__abeleTest.AbeleConfig.getInstance()
            config.github.connections.find(c => c.id === 'two').name = 'Sample Forgejo account with a deliberately long descriptive name'
            config.version.value++
            root = await open('long-widget-repository-with-a-deliberately-descriptive-name')
            await shoot('long-home',root)
            config.github.connections.find(c => c.id === 'two').name = 'Sample Forgejo two'
            config.version.value++
            root = await open('private-widgets')
            if (!root.textContent.includes('private')) throw Error('Private metadata missing')
            await shoot('private-home',root)
            root = await open('empty-widgets')
            if (!root.textContent.includes('no files yet')) throw Error('Empty repository state missing')
            await shoot('empty-home',root)
            root = await open(${JSON.stringify(REPO + '/issues')})
            if (!root.textContent.includes('Not available for this service')) throw Error('Unsupported list explanation missing')
            await shoot('unavailable-list',root)
            root = await open('missing-widgets')
            await shoot('missing-repository',root)
            root = await open('private-widgets','one')
            if (!(await until(() => root.textContent.includes('404')))) throw Error('Explicit account unexpectedly fell back')
            await shoot('account-refused',root)
            root = await open(${JSON.stringify(REPO + '/issues/' + ISSUE)})
            if (!root.textContent.includes('Loader hangs')) throw Error('Issue missing')
            await shoot('issue-conversation',root)
            root = await open('partial-widgets/pulls/${PULL}')
            if (!(await until(() => root.textContent.includes('could not be read')))) throw Error('Partial conversation failure missing')
            if (!root.textContent.includes('Rework the widget loader')) throw Error('Primary content was erased')
            await shoot('partial-conversation',root)
            root = await open(${JSON.stringify(REPO + '/pulls/' + PULL)})
            if (!(await until(() => root.textContent.includes('Looks fine overall')))) throw Error('Review missing')
            await shoot('pull-conversation',root)
            root = await open(${JSON.stringify(REPO + '/pulls/' + PULL + '/files')})
            if (!(await until(() => root.querySelector('.abele-github-file') && root.textContent.includes('Why load them all')))) throw Error('PR files or inline comments missing: '+root.textContent.slice(0,1500))
            if (!(await until(() => root.querySelector('.cm-editor')))) throw Error('Native patch did not render')
            const patch = !!root.querySelector('.cm-editor')
            await shoot('pull-files',root)
            const inline = root.querySelector('.abele-github-file__comments')
            if (!inline) throw Error('Inline review state missing')
            inline.scrollIntoView({block:'center'}); await shoot('inline-review')
            root = await open(${JSON.stringify(REPO + '/pulls/' + PULL + '/commits')})
            if (!(await until(() => root.textContent.includes('Add the loader')))) throw Error('PR commits missing')
            await shoot('pull-commits',root)
            root = await open(${JSON.stringify(REPO + '/src/branch/main/src')})
            await shoot('folder',root)
            const treeButton = [...root.querySelectorAll('[aria-label]')].find(el => el.getAttribute('aria-label')?.includes("repository's files"))
            if (!treeButton) throw Error('File tree action missing')
            treeButton.click()
            const tree = await until(() => root.querySelector('.abele-github-tree [data-path="src"]'))
            if (!tree) throw Error('Native file tree missing')
            if (!root.querySelector('.abele-github-tree [data-path="src/app.ts"]')) tree.click()
            const appFile = await until(() => root.querySelector('.abele-github-tree [data-path="src/app.ts"]'))
            if (!appFile) throw Error('Native tree expansion failed')
            await shoot('tree',root)
            appFile.click()
            if (!(await until(() => leaf.view.model.url.includes('/src/commit/') && root.querySelector('.cm-editor')))) throw Error('Native tree did not open an immutable file link')
            root.querySelector('.abele-github-tree__close')?.click()
            root = await open(${JSON.stringify(REPO + '/src/commit/' + HEAD_SHA + '/src/app.ts#L4-L6')})
            if (!(await until(() => root.querySelector('.cm-editor')))) throw Error('File view missing')
            await shoot('file-lines',root)
            const nativeLink = leaf.view.getState().sourceTarget.url
            const blame = [...root.querySelectorAll('[aria-label],button')].find(el => /blame/i.test(el.getAttribute('aria-label') || el.textContent))
            if (!blame) throw Error('Blame action missing')
            blame.click()
            if (!(await until(() => root.textContent.includes('Not available for this service')))) throw Error('Unsupported blame explanation missing')
            await shoot('unavailable-blame',root)
            root = await open(${JSON.stringify(REPO + '/src/tag/' + TAG)})
            await shoot('tag-home',root)
            const version = root.querySelector('.abele-github-home__ref')
            if (!version) throw Error('Ref picker action missing')
            version.click(); await wait(200)
            if (!document.body.textContent.includes(${JSON.stringify(TAG)})) throw Error('Tag not listed')
            await shoot('refs'); document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await wait(150)
            const accountButton = root.querySelector('.abele-github__account')
            accountButton.click(); await wait(150)
            if (!document.body.textContent.includes('Open as Sample Forgejo one')) throw Error('Account menu missing')
            await shoot('accounts')
            document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await wait(150)
            const account = leaf.view.model.connectionId
            const viewportScroller = root.querySelector('.view-content')
            const sideways = Math.max(largestSideways, viewportScroller ? viewportScroller.scrollWidth - viewportScroller.clientWidth : 0)
            for (const opened of githubLeaves()) opened.detach()
            return {states,sideways,account,nativeLink,patch}
          })()`,
            240_000
          )
          expect(result.account).toBe('two')
          expect(result.patch).toBe(true)
          expect(result.nativeLink).toContain('/src/commit/')
          expect(result.sideways).toBeLessThanOrEqual(2)
          expect(result.states).toContain('unavailable-blame')
          console.info('Forgejo captured states', layout, result.states)
        } finally {
          closeDialogs()
          restoreGithub()
        }
      }
      if (layout === 'phone') await withEmulatedPhone(probe)
      else await probe()
    }, 360_000)

    it(`checks unsaved provider credentials and captures editor states in ${layout}`, async () => {
      const probe = async () => {
        enable()
        try {
          const result = evalAsync<{
            account: boolean
            tokenExposed: boolean
            pictures: string[]
            saved: boolean
          }>(
            `(async () => {
            ${PRELUDE}
            window.__abeleTest.openDialog('github-connections')
            const settings = await until(() => document.querySelector('.abele-settings__github'))
            const add = [...settings.querySelectorAll('button')].find(b => b.textContent.trim() === 'Add connection')
            if (!add) throw Error('Add connection missing')
            add.click()
            let modal = await until(() => document.querySelector('input[placeholder="github_pat_..."]')?.closest('.modal.abele-modal'))
            if (!modal) throw Error('Connection editor missing')
            const store = window.__abeleTest.secrets(), oldSet = store.set, oldGet = store.get, written = new Map()
            store.set = function(id,value) { written.set(id,value); this.version.value++ }
            store.get = function(id) { return written.has(id) ? written.get(id) : oldGet.call(this,id) }
            try {
            const pictures = []
            const shoot = async name => {
              await wait(250)
              const image = await require('@electron/remote').getCurrentWebContents().capturePage()
              const path = ${JSON.stringify(shots + '/' + layout + '-editor-')}+name+'.png'
              require('fs').writeFileSync(path,image.toPNG()); pictures.push(path)
            }
            const select = modal.querySelector('select')
            select.value = 'forgejo'; select.dispatchEvent(new Event('change',{bubbles:true})); await wait(100)
            await shoot('empty')
            const set = (placeholder,value) => { const input = [...modal.querySelectorAll('input')].find(i => i.placeholder === placeholder); if (!input) throw Error('Input missing: '+placeholder); input.value=value; input.dispatchEvent(new Event('input',{bubbles:true})) }
            set('https://git.example.test','https://git.example.test?query=sample'); await wait(100)
            if (!modal.textContent.includes('Only the address: no login, query or # part')) throw Error('Invalid server explanation missing')
            await shoot('invalid-server')
            set('Connection name','Sample Forgejo connection with a deliberately long descriptive account label')
            set('https://git.example.test',${JSON.stringify(server.origin + '/forge')})
            set('Access token','invalid-sample-token')
            set('owner/repo or a Forgejo link',${JSON.stringify(OWNER + '/' + REPO)})
            await shoot('long')
            const check = () => [...modal.querySelectorAll('button')].find(b => b.textContent.trim() === 'Check access').click()
            check()
            if (!(await until(() => modal.textContent.includes('401')))) throw Error('Refused access state missing')
            modal.querySelector('.abele-status-dot').scrollIntoView({block:'start'}); await shoot('refused')
            set('Access token','invented-connection-one')
            set('owner/repo or a Forgejo link',${JSON.stringify(OWNER + '/private-widgets')}); await wait(100); check()
            if (!(await until(() => modal.textContent.includes('Signed in as sample-account-one') && modal.textContent.includes('— Repository')))) throw Error('Partial repository access missing')
            modal.querySelector('.abele-status-dot').scrollIntoView({block:'center'}); await shoot('partial-access')
            set('owner/repo or a Forgejo link',${JSON.stringify(OWNER + '/' + REPO)})
            set('Access token','invented-connection-two'); await wait(100); check()
            if (!(await until(() => modal.textContent.includes('Signed in as sample-account-two')))) throw Error('Native access report missing: '+modal.textContent)
            modal.querySelector('.abele-status-dot').scrollIntoView({block:'start'}); await shoot('checked')
            const account = modal.textContent.includes('Signed in as sample-account-two')
            modal.querySelector('.abele-disclosure__control').click(); await wait(100)
            modal.querySelector('.abele-github-access').scrollIntoView({block:'start'}); await shoot('access-details')
            const tokenExposed = modal.textContent.includes('invented-connection-two')
            const save = [...modal.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save'); save.click()
            const config = window.__abeleTest.AbeleConfig.getInstance()
            const added = await until(() => config.github.connections.find(c => c.provider === 'forgejo' && c.account?.login === 'sample-account-two'))
            if (!added || written.get(added.keyId) !== 'invented-connection-two') throw Error('Save did not retain the checked connection with its own credential')
            const row = [...settings.querySelectorAll('.setting-item')].find(el => el.textContent.includes(added.name))
            row.scrollIntoView({block:'center'}); await shoot('saved')
            return {account,tokenExposed,pictures,saved:true}
            } finally { store.set = oldSet; store.get = oldGet; store.version.value++ }
          })()`,
            120_000
          )
          expect(result.account).toBe(true)
          expect(result.tokenExposed).toBe(false)
          expect(result.saved).toBe(true)
          expect(result.pictures).toHaveLength(8)
        } finally {
          closeDialogs()
          restoreGithub()
        }
      }
      if (layout === 'phone') await withEmulatedPhone(probe)
      else await probe()
    }, 300_000)
  }
})
