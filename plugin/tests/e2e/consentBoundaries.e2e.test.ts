import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('abele-consent-boundaries')

describe.skipIf(!isObsidianRunning() || !hasTestApi())(
  'native imported permission and composed Basic boundaries',
  () => {
    it('warns on the blank reopened HTTP row and uses real persisted script approval for composed HTTPS credentials', async () => {
      const raw = await evalLong(
        `(async () => {
      const t = window.__abeleTest, config = t.AbeleConfig.getInstance(), store = t.secrets()
      const oldAi = JSON.parse(JSON.stringify(config.ai))
      const keys = ['abele-key-destinations-v1', 'abele-key-http-origins-v1'], local = keys.map(key => app.loadLocalStorage(key))
      const id = 'sample-imported-console', name = 'Imported console'
      const http = 'http://192.168.96.23:8387', https = 'https://composed-console.sample.example'
      const user = 'sample-user', password = 'fake-imported:material', composed = 'prefix-' + password + '-suffix'
      const full = 'Basic ' + btoa(user + ':' + composed), ordinary = 'Basic ' + btoa(user + ':' + password)
      const out = { calls: 0 }, plugin = app.plugins.plugins.abele
      let modal
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      const until = async fn => { for(let i=0;i<200;i++){ if(fn())return; await wait(50) } throw Error('Consent boundary did not settle') }
      const shot = async label => {
        await wait(250)
        const path = ${JSON.stringify(shots)} + '/' + label + '.png'
        require('fs').writeFileSync(path, (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())
        return path
      }
      const context = () => t.networkSecurity.buildScriptContext({ params: {}, signal: new AbortController().signal, logs: [] })
      try {
        if (store.get(id)) throw Error('Fixture slot already exists')
        config.ai = { ...oldAi, providers: [], imageProviders: [], mcpServers: [], braveSearchApiKey: '',
          voice: { ...oldAi.voice, apiKeyId: 'abele-openrouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions' },
          secrets: [{ name, keyId: id, allowedOrigins: [http] }] }
        store.set(id, password); await store.flush(); await config.saveSettings(); await config.reloadSettings()
        app.saveLocalStorage(keys[0], { 'abele-openrouter': ['https://openrouter.ai'] }); app.saveLocalStorage(keys[1], [])
        t.networkSecurity.setRequestTransport(async req => {
          out.calls++
          const expected = req.url.startsWith(http) ? ordinary : full
          out.headersCorrect = (out.headersCorrect ?? true) && req.headers.Authorization === expected
          return { status: req.headers.Authorization === expected ? 200 : 401, headers: { 'X-Echo': expected, 'content-type': 'text/plain' },
            text: [expected, expected.slice(6), user + ':' + composed].join('|'), arrayBuffer: new ArrayBuffer(0) }
        })
        modal = t.networkSecurity.reviewKeyDestinations()
        out.blank = modal.bodyEl.querySelector('input[aria-label="Recipient address"]').value === '' && modal.bodyEl.querySelector('select').value === ''
        const row = modal.bodyEl.querySelector('[data-key-destination]')
        out.warned = row.textContent.includes(http) && row.textContent.includes('Unencrypted: anyone on the network path can read the key.')
        out.importedShot = await shot('imported-http-warning')
        ;[...row.querySelectorAll('button')].find(button => button.textContent === 'Allow unencrypted HTTP').click()
        await until(() => modal.bodyEl.textContent.includes('Allowed on this device'))
        out.callsDuringConsent = out.calls
        modal.close(); modal = null
        await config.reloadSettings(); await store.load()
        out.httpPersisted = (await plugin.loadData()).ai.secrets.find(key => key.keyId === id).allowedOrigins.includes(http)
        out.httpSuccess = (await context().fetch(http + '/stats', { headers: { Authorization: ordinary } })).status === 200
        const request = { url: https + '/stats', basicAuth: { username: user, password: 'prefix-\${abele_key:Imported console}-suffix' } }
        const work = context().fetch(request.url, { basicAuth: request.basicAuth })
        await until(() => document.querySelector('.modal'))
        out.scriptShot = await shot('script-composed-approval')
        ;[...document.querySelectorAll('.modal button')].find(button => button.textContent === 'Allow address and send').click()
        const answer = await work
        out.scriptRedacted = ![password, composed, full, full.slice(6), user + ':' + composed].some(value => JSON.stringify(answer).includes(value))
        out.httpsPersisted = (await plugin.loadData()).ai.secrets.find(key => key.keyId === id).allowedOrigins.includes(https)
        const result = await t.createAgentTools().find(tool => tool.name === 'fetch').execute('sample-composed-call', request)
        out.toolRedacted = ![password, composed, full, full.slice(6), user + ':' + composed].some(value => result.content[0].text.includes(value))
        out.noDuplicate = config.ai.secrets.length === 1
        out.noPlaintext = !JSON.stringify(await plugin.loadData()).includes(password)
        modal = t.networkSecurity.reviewKeyDestinations()
        out.persistedShot = await shot('persisted-permissions')
      } finally {
        modal?.close(); t.networkSecurity.setRequestTransport(undefined)
        config.ai = oldAi
        if (store.get(id) === password) { store.remove(id); await store.flush() }
        await config.saveSettings(); await config.reloadSettings()
        keys.forEach((key,i) => app.saveLocalStorage(key, local[i]))
      }
      return out
    })()`,
        90_000
      )
      if (raw.startsWith('Error:')) throw new Error(raw)
      const report = JSON.parse(raw)
      console.info(JSON.stringify(report))
      for (const field of [
        'blank',
        'warned',
        'headersCorrect',
        'httpPersisted',
        'httpSuccess',
        'scriptRedacted',
        'httpsPersisted',
        'toolRedacted',
        'noDuplicate',
        'noPlaintext',
      ])
        expect(report[field]).toBe(true)
      expect(report.callsDuringConsent).toBe(0)
      expect(report.calls).toBe(3)
    }, 120_000)
  }
)
