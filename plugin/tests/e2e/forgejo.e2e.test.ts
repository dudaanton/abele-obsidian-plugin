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
import { HEAD_SHA, BASE_SHA, OWNER, REPO, PULL, ISSUE, TAG } from './helpers/fakeGithubRepo'

const available = isObsidianRunning() && hasTestApi()

for (const provider of ['forgejo', 'gitea'] as const) {
  describe.skipIf(!available)(`${provider} repository workflows against a local native API`, () => {
    const shots = shotDir(`abele-${provider}`)
    let server: FakeGithub
    beforeAll(async () => {
      server = await startFakeGithub({ mode: provider })
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
      config.github.connections = ['one','two'].map((id,i) => ({ id, provider:${JSON.stringify(provider)}, name:'Sample Forgejo '+id, server:${JSON.stringify(server.origin + '/forge')}, keyId:'sample-forgejo-'+id, owners:[], isDefault:i===0, account:{login:'sample-account-'+id} }))
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
              if (!(await until(() => root.querySelector('.abele-github-header') && !root.textContent.includes(${JSON.stringify(provider === 'gitea' ? 'Loading from Gitea' : 'Loading from Forgejo')}) && (root.querySelector('.abele-github-list') || root.querySelector('.abele-github-home') || root.querySelector('.abele-github-thread') || root.querySelector('.abele-github-files') || root.querySelector('.abele-github-commits') || root.querySelector('.abele-github-blob') || root.querySelector('.abele-github-folder') || root.querySelector('.abele-github-notice')))))
                throw Error('Forgejo view did not finish: '+root.textContent.slice(0,1000))
              return root
            }
            let root = await open(${JSON.stringify(REPO)})
            if (!(await until(() => root.querySelector('.abele-github-folder__readme h1')))) throw Error('README missing')
            await shoot('public-home',root)
            const dismissPicker = async (selector) => {
              document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',code:'Escape',keyCode:27,bubbles:true}))
              if (!(await until(() => !document.querySelector(selector)))) throw Error('Native picker did not close')
            }
            app.commands.executeCommandById('abele:open-github-link')
            if (!(await until(() => document.querySelector('.abele-github-open input')))) throw Error('Native item picker missing')
            const itemInput = document.querySelector('.abele-github-open input')
            itemInput.value = '#7'; itemInput.dispatchEvent(new Event('input',{bubbles:true}))
            if (!(await until(() => document.querySelector('.abele-github-open .suggestion-title')?.textContent.includes('Loader')))) throw Error('Native item suggestion missing')
            await shoot('native-item-picker',root)
            await dismissPicker('.abele-github-open')
            app.commands.executeCommandById('abele:open-github-repository')
            if (!(await until(() => document.querySelector('.abele-github-repos .suggestion-item')))) throw Error('Native repository picker missing')
            await shoot('native-repository-picker',root)
            await dismissPicker('.abele-github-repos')

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
            if (!root.textContent.includes('Loader hangs')) throw Error('Native issue list missing')
            await shoot('issue-list',root)
            root = await open('missing-widgets')
            await shoot('missing-repository',root)
            root = await open('private-widgets','one')
            if (!(await until(() => root.textContent.includes('404')))) throw Error('Explicit account unexpectedly fell back')
            await shoot('account-refused',root)
            root = await open(${JSON.stringify(REPO + '/issues/' + ISSUE)})
            if (!root.textContent.includes('Loader hangs')) throw Error('Issue missing')
            await shoot('issue-conversation',root)
            const editor = root.querySelector('textarea[aria-label="Comment"]')
            if (!editor) throw Error('Native comment editor missing')
            editor.scrollIntoView({block:'center'}); await shoot('comment-editor')
            editor.value = ${JSON.stringify(`Sample ${provider} comment in ${layout}`)}
            editor.dispatchEvent(new Event('input',{bubbles:true})); await wait(50)
            const submit = [...root.querySelectorAll('button')].find(b => b.textContent === 'Comment')
            submit.click()
            if (!(await until(() => root.querySelector('.abele-github-thread')?.textContent.includes(${JSON.stringify(`Sample ${provider} comment in ${layout}`)})))) throw Error('Submitted native comment missing')
            await shoot('comment-submitted',root)
            if (!(await until(() => root.querySelector('.abele-github-user_named')))) throw Error('Native profile missing')
            await shoot('native-people',root)
            if (!(await until(() => [...root.querySelectorAll('.abele-github-user img')].some(image => image.complete && image.naturalWidth > 0)))) throw Error('Credential-free native avatar missing')
            root = await open('partial-widgets/pulls/${PULL}')
            if (!(await until(() => root.textContent.includes('could not be read')))) throw Error('Partial conversation failure missing')
            if (!root.textContent.includes('Rework the widget loader')) throw Error('Primary content was erased')
            await shoot('partial-conversation',root)
            root = await open(${JSON.stringify(REPO + '/pulls/' + PULL)})
            if (!(await until(() => root.textContent.includes('Looks fine overall')))) throw Error('Review missing')
            await shoot('pull-conversation',root)
            const merge = [...root.querySelectorAll('button')].find(b => b.textContent === 'Merge')
            if (!merge) throw Error('Native merge action missing')
            merge.click(); await wait(200); await shoot('merge-confirmation')
            document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await wait(150)
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
            const compare = root.querySelector('[aria-label="Compare against a branch, tag or commit…"]')
            if (!compare) throw Error('Native comparison action missing')
            compare.click()
            const prompt = await until(() => document.querySelector('.abele-github-base-picker'))
            if (!prompt) throw Error('Comparison base picker missing')
            const input = prompt.querySelector('input')
            input.value = ${JSON.stringify(BASE_SHA)}; input.dispatchEvent(new Event('input',{bubbles:true}))
            if (!(await until(() => prompt.textContent.includes('Compare against commit')))) throw Error('Base did not resolve')
            await shoot('comparison-picker')
            prompt.querySelector('.suggestion-item').click()
            if (!(await until(() => root.querySelector('.abele-github-pinned .cm-editor')))) throw Error('Native endpoint diff missing: '+root.textContent.slice(0,1000))
            await shoot('pinned-file',root)
            ;[...root.querySelectorAll('button')].find(button => button.textContent === 'Unpin')?.click()
            if (!(await until(() => !root.querySelector('.abele-github-pinned') && root.querySelector('.cm-editor')))) throw Error('Unpin failed')
            root = await open(${JSON.stringify(REPO + '/commit/' + HEAD_SHA)})
            if (!(await until(() => root.querySelector('.abele-github-files .cm-editor')))) throw Error('Native commit patch missing')
            await shoot('commit-files',root)
            root.querySelector('[aria-label="Search the code: this change, the whole repository, or file names"]').click()
            const changedSearch = await until(() => root.querySelector('.abele-github-search'))
            const changedQuery = changedSearch.querySelector('input')
            changedQuery.value = 'loadWidgets'; changedQuery.dispatchEvent(new Event('input',{bubbles:true}))
            if (!(await until(() => [...changedSearch.querySelectorAll('button')].some(button => button.textContent === 'Search' && !button.disabled)))) throw Error('Changed-code search did not accept the input')
            ;[...changedSearch.querySelectorAll('button')].find(button => button.textContent === 'Search').click()
            if (!(await until(() => changedSearch.querySelector('.abele-github-search__line')))) throw Error('Changed-code search missing: '+changedSearch.textContent)
            if (!changedSearch.textContent.includes('without a precise diff anchor')) throw Error('Diff link limitation missing')
            await shoot('changed-code-search',root)
            root.querySelector('[aria-label="Close code search"]')?.click()
            root = await open(${JSON.stringify(REPO + '/src/commit/' + HEAD_SHA + '/src/app.ts#L4-L6')})
            if (!(await until(() => root.querySelector('.cm-editor')))) throw Error('File did not reopen')
            root.querySelector('[aria-label="Search the code: this change, the whole repository, or file names"]').click()
            const search = await until(() => root.querySelector('.abele-github-search'))
            if (!search) throw Error('Native search did not open')
            const query = search.querySelector('input')
            query.value = 'loadWidgets'; query.dispatchEvent(new Event('input',{bubbles:true}))
            if (!(await until(() => [...search.querySelectorAll('button')].some(button => button.textContent === 'Search' && !button.disabled)))) throw Error('Repository search did not accept the input')
            ;[...search.querySelectorAll('button')].find(button => button.textContent === 'Search').click()
            if (!(await until(() => search.querySelector('.abele-github-search__line')))) throw Error('Exact archive search missing: '+search.textContent)
            await shoot('code-search',root)
            search.querySelector('.abele-github-search__line').click()
            if (!(await until(() => leaf.view.model.url.includes('/src/commit/')))) throw Error('Search did not retain immutable native link')
            root.querySelector('[aria-label="Close code search"]')?.click()
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
            const snippetPath = ${JSON.stringify(`ScaleTest/Notes/sample-${provider}-${layout}-snippet.md`)}
            const fence = String.fromCharCode(96).repeat(3)
            const snippetFile = await app.vault.create(snippetPath, [fence+'abele-forge', 'version: 1', 'provider: '+${JSON.stringify(provider)}, 'server: '+${JSON.stringify(server.origin + '/forge')}, 'repository: '+${JSON.stringify(OWNER + '/' + REPO)}, 'url: '+${JSON.stringify(server.origin + '/forge/' + OWNER + '/' + REPO + '/src/commit/' + HEAD_SHA + '/src/app.ts#L4-L6')}, 'label: Sample retained native code', 'lang: ts', 'start: 4', '---', 'export const sampleSnippet = true', fence].join(String.fromCharCode(10)))
            const snippetLeaf = app.workspace.getLeaf('tab')
            try {
              await snippetLeaf.setViewState({type:'markdown',active:true,state:{file:snippetPath,mode:'preview'}})
              if (!(await until(() => snippetLeaf.view.containerEl.querySelector('.abele-github-snippet .cm-editor')))) throw Error('Native snippet did not render')
              await shoot('native-snippet',snippetLeaf.view.containerEl)
            } finally { snippetLeaf.detach(); await app.vault.delete(snippetFile) }
            window.__abeleTest.openDialog('native-pr-create')
            if (!(await until(() => document.querySelector('.abele-pr-dialog')))) throw Error('Native PR creation dialog missing')
            await shoot('native-pr-create')
            const prTitle = document.querySelector('.abele-pr-dialog input[aria-label="Title"]')
            prTitle.value = ''; prTitle.dispatchEvent(new Event('input',{bubbles:true})); await wait(50)
            await shoot('native-pr-create-empty')
            ;[...document.querySelectorAll('.abele-pr-dialog button')].find(b => b.textContent === 'Cancel').click()
            if (!(await until(() => !document.querySelector('.abele-pr-dialog')))) throw Error('Native PR cancellation did not close')
            const inboxLeaf = app.workspace.getLeaf('tab')
            await inboxLeaf.setViewState({type:'abele-github-notifications',active:true,state:{which:'all',repo:'',inboxVersion:1,connection:'two'}})
            const inboxRoot = inboxLeaf.view.containerEl
            if (!(await until(() => inboxRoot.textContent.includes('Sample native notification')))) throw Error('Native inbox missing: '+inboxRoot.textContent)
            if (inboxRoot.querySelector('[aria-label*="Done on"]')) throw Error('Unsupported Done action in native inbox')
            await shoot('native-inbox',inboxRoot)
            const read = inboxRoot.querySelector('.abele-native-notification__read')
            read?.click(); await wait(400); await shoot('native-inbox-read',inboxRoot)
            await inboxLeaf.view.setState({which:'unread',repo:'',inboxVersion:1,connection:'two'},{history:false})
            if (!(await until(() => inboxRoot.textContent.includes('No notifications in this view')))) throw Error('Native empty inbox missing')
            await shoot('native-inbox-empty',inboxRoot)
            await inboxLeaf.view.setState({which:'all',repo:'',inboxVersion:1,connection:'missing-sample'},{history:false})
            if (!(await until(() => inboxRoot.textContent.includes('connection is unavailable')))) throw Error('Missing inbox account was silently replaced')
            await shoot('native-inbox-missing',inboxRoot)
            await inboxLeaf.view.setState({which:'all',repo:'',inboxVersion:1,connection:'one'},{history:false})
            if (!(await until(() => inboxRoot.textContent.includes('Open in browser')))) throw Error('Unsupported notification target has no browser exit')
            await shoot('native-inbox-browser-exit',inboxRoot)
            inboxLeaf.detach()
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
            select.value = ${JSON.stringify(provider)}; select.dispatchEvent(new Event('change',{bubbles:true})); await wait(100)
            await shoot('empty')
            if (${JSON.stringify(provider)} === 'forgejo') {
            const preset = [...modal.querySelectorAll('button')].find(button => button.textContent === 'Use Codeberg')
            if (!preset) throw Error('Codeberg preset missing')
            preset.click(); await wait(100)
            if (![...modal.querySelectorAll('input')].some(input => input.value === 'https://codeberg.org')) throw Error('Codeberg did not populate the Forgejo address')
            await shoot('codeberg-preset')
            }
            const set = (placeholder,value) => { const input = [...modal.querySelectorAll('input')].find(i => i.placeholder === placeholder); if (!input) throw Error('Input missing: '+placeholder); input.value=value; input.dispatchEvent(new Event('input',{bubbles:true})) }
            set('https://git.example.test','https://git.example.test?query=sample'); await wait(100)
            if (!modal.textContent.includes('Only the address: no login, query or # part')) throw Error('Invalid server explanation missing')
            await shoot('invalid-server')
            set('Connection name','Sample Forgejo connection with a deliberately long descriptive account label')
            set('https://git.example.test',${JSON.stringify(server.origin + '/forge')})
            set('Access token','invalid-sample-token')
            set(${JSON.stringify('owner/repo or a ' + (provider === 'gitea' ? 'Gitea' : 'Forgejo') + ' link')},${JSON.stringify(OWNER + '/' + REPO)})
            await shoot('long')
            const check = () => [...modal.querySelectorAll('button')].find(b => b.textContent.trim() === 'Check access').click()
            check()
            if (!(await until(() => modal.textContent.includes('401')))) throw Error('Refused access state missing')
            modal.querySelector('.abele-status-dot').scrollIntoView({block:'start'}); await shoot('refused')
            set('Access token','invented-connection-one')
            set(${JSON.stringify('owner/repo or a ' + (provider === 'gitea' ? 'Gitea' : 'Forgejo') + ' link')},${JSON.stringify(OWNER + '/private-widgets')}); await wait(100); check()
            if (!(await until(() => modal.textContent.includes('Signed in as sample-account-one') && modal.textContent.includes('— Repository')))) throw Error('Partial repository access missing')
            modal.querySelector('.abele-status-dot').scrollIntoView({block:'center'}); await shoot('partial-access')
            set(${JSON.stringify('owner/repo or a ' + (provider === 'gitea' ? 'Gitea' : 'Forgejo') + ' link')},${JSON.stringify(OWNER + '/' + REPO)})
            set('Access token','invented-connection-two'); await wait(100); check()
            if (!(await until(() => modal.textContent.includes('Signed in as sample-account-two')))) throw Error('Native access report missing: '+modal.textContent)
            modal.querySelector('.abele-status-dot').scrollIntoView({block:'start'}); await shoot('checked')
            const account = modal.textContent.includes('Signed in as sample-account-two')
            modal.querySelector('.abele-disclosure__control').click(); await wait(100)
            modal.querySelector('.abele-github-access').scrollIntoView({block:'start'}); await shoot('access-details')
            const tokenExposed = modal.textContent.includes('invented-connection-two')
            const save = [...modal.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save'); save.click()
            const config = window.__abeleTest.AbeleConfig.getInstance()
            const added = await until(() => config.github.connections.find(c => c.provider === ${JSON.stringify(provider)} && c.account?.login === 'sample-account-two'))
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
            expect(result.pictures).toHaveLength(provider === 'forgejo' ? 9 : 8)
          } finally {
            closeDialogs()
            restoreGithub()
          }
        }
        if (layout === 'phone') await withEmulatedPhone(probe)
        else await probe()
      }, 300_000)
    }
    it('runs all neutral tools and an operation-local native Ask grant through the execution factory', () => {
      enable()
      try {
        const result = evalAsync<{
          names: string[]
          asked: boolean
          aliasOff: boolean
          revoked: boolean
        }>(
          `(async()=>{
          ${PRELUDE}
          const registry = window.__abeleTest.AgentRegistry.getInstance()
          const names = ['views','read','pr_files','file','commits','search','grep','open'].map(name=>'forge_'+name)
          const agent = registry.create({name:'Sample native execution',githubConnections:{one:'off',two:'auto'},toolModes:Object.fromEntries(names.map(name=>[name,'auto']))})
          const before = new Set(githubLeaves())
          try {
            const tools = window.__abeleTest.createAgentTools({agentId:agent.id,githubApproval:window.__abeleTest.connectionApproval(app)})
            const tool = name => registry.filterTools(agent,tools).find(t=>t.name===name)
            const call = (name,params) => tool('forge_'+name).execute('sample-native-'+name,{connection:'two',...params})
            const repo = ${JSON.stringify(server.origin + '/forge/' + OWNER + '/' + REPO)}
            const outputs = []
            outputs.push(await call('views',{}))
            outputs.push(await call('read',{item:repo+'/issues/${ISSUE}'}))
            outputs.push(await call('pr_files',{item:repo+'/pulls/${PULL}'}))
            outputs.push(await call('file',{repo,path:'src/app.ts',ref:${JSON.stringify(HEAD_SHA)}}))
            outputs.push(await call('commits',{repo,sha:${JSON.stringify(HEAD_SHA)}}))
            outputs.push(await call('search',{repo,type:'issues',query:'loader'}))
            outputs.push(await call('grep',{repo,ref:${JSON.stringify(HEAD_SHA)},query:'loadWidgets'}))
            outputs.push(await call('open',{url:repo+'/src/commit/${HEAD_SHA}/src/app.ts#L4-L6'}))
            const autoTab = await until(() => githubLeaves().find(leaf => leaf.view.model?.executionAgentId === agent.id))
            if (!autoTab) throw Error('Native agent tab missing')
            if (autoTab.view.model.approvedConnections?.two) throw Error('Auto open manufactured an Ask grant')
            agent.toolModes.github_file = 'off'
            const aliasOff = !tool('github_file') && !!tool('forge_file')
            agent.githubConnections.two = 'ask'
            const pending = call('file',{repo,path:'src/app.ts',ref:${JSON.stringify(HEAD_SHA)}})
            const allow = await until(()=>[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Allow once'))
            const asked = !!allow && document.body.textContent.includes('Sample Forgejo two') && document.body.textContent.includes(${JSON.stringify(server.origin + '/forge')})
            if (!allow) throw Error('Native Ask dialog missing')
            allow.click(); await pending
            if (agent.githubConnections.two !== 'ask') throw Error('Ask approval changed the saved mode')
            const askOpen = call('open',{url:repo+'/issues/${ISSUE}'})
            const allowOpen = await until(()=>[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Allow once'))
            if (!allowOpen) throw Error('Native Ask open dialog missing')
            allowOpen.click(); await askOpen
            const approvedTab = githubLeaves().find(leaf => leaf.view.model?.executionAgentId === agent.id && leaf.view.model?.url.includes('/issues/${ISSUE}'))
            if (!approvedTab?.view.model.approvedConnections?.two) throw Error('Approved Ask open lost its grant')
            agent.githubConnections.two = 'off'
            let revoked = false
            try { await call('file',{repo,path:'src/app.ts'}) } catch { revoked = true }
            if (!JSON.stringify(outputs).includes('loadWidgets')) throw Error('Native execution returned no repository content')
            return {names,asked,aliasOff,revoked}
          } finally { for (const leaf of githubLeaves()) if (!before.has(leaf)) leaf.detach(); registry.remove(agent.id) }
        })()`,
          120_000
        )
        expect(result.names).toHaveLength(8)
        expect(result.asked).toBe(true)
        expect(result.aliasOff).toBe(true)
        expect(result.revoked).toBe(true)
      } finally {
        closeDialogs()
        restoreGithub()
      }
    }, 150_000)
  })
}
