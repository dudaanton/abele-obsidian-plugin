import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('abele-basic-consent')

describe.skipIf(!isObsidianRunning() || !hasTestApi())(
  'saved password consent through real native UI and persistence',
  () => {
    it('reopens the saved pair and sends the unchanged Basic script without a duplicate secret', async () => {
      const raw = await evalLong(
        `(async () => {
      const t = window.__abeleTest, config = t.AbeleConfig.getInstance(), store = t.secrets()
      const oldAi = JSON.parse(JSON.stringify(config.ai))
      const localKeys = ['abele-key-destinations-v1', 'abele-key-http-origins-v1']
      const oldLocal = localKeys.map(k => app.loadLocalStorage(k))
      const id = 'sample-grove-password', name = 'Grove password'
      const origin = 'http://192.168.63.27:8786', password = 'fake-grove:password', user = 'grove-user'
      const basic = 'Basic ' + btoa(user + ':' + password)
      const out = { calls: 0 }, plugin = app.plugins.plugins.abele
      let modal
      const wait = ms => new Promise(r => setTimeout(r, ms))
      const until = async fn => { for(let i=0;i<200;i++){ if(fn())return; await wait(50) } throw Error('Consent did not settle') }
      const shot = async label => {
        await wait(250)
        const path = ${JSON.stringify(shots)} + '/' + label + '.png'
        require('fs').writeFileSync(path, (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())
        return path
      }
      const field = (label, value) => {
        const input = modal.bodyEl.querySelector('input[aria-label="' + label + '"]')
        input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const retry = () => t.networkSecurity.buildScriptContext({ params: {}, signal: new AbortController().signal, logs: [] }).fetch(origin + '/stats', { headers: { Authorization: basic } })
      try {
        if (store.get(id)) throw Error('Fixture slot already exists')
        config.ai = { ...oldAi, secrets: [{ name, keyId: id }], providers: [], imageProviders: [], mcpServers: [], braveSearchApiKey: '', voice: { ...oldAi.voice, apiKeyId: 'abele-openrouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions' } }
        store.set(id, password); await store.flush(); await config.saveSettings()
        app.saveLocalStorage(localKeys[0], { 'abele-openrouter': ['https://openrouter.ai'] }); app.saveLocalStorage(localKeys[1], [])
        t.networkSecurity.setRequestTransport(async req => {
          out.calls++
          out.correctHeader = req.headers.Authorization === basic
          return { status: req.headers.Authorization === basic ? 200 : 401, headers: { 'content-type': 'text/plain' }, text: req.headers.Authorization || '', arrayBuffer: new ArrayBuffer(0) }
        })
        try { await retry(); out.blockedBefore = false } catch { out.blockedBefore = true }
        modal = t.networkSecurity.reviewKeyDestinations()
        out.beforeShot = await shot('before')
        const address = modal.bodyEl.querySelector('input[aria-label="Recipient address"]')
        address.value = origin + '/stats'; address.dispatchEvent(new Event('input', { bubbles: true }))
        const picker = modal.bodyEl.querySelector('select[aria-label="Saved key"]')
        picker.value = id; picker.dispatchEvent(new Event('change', { bubbles: true }))
        out.formShot = await shot('selected-password')
        ;[...modal.footerEl.querySelectorAll('button')].find(b => b.textContent === 'Allow key and address').click()
        await until(() => modal.bodyEl.textContent.includes('Retry'))
        out.callsDuringConsent = out.calls
        const disk = await plugin.loadData()
        out.diskPair = disk.ai.secrets.find(s => s.keyId === id)?.allowedOrigins
        out.noPlaintext = !JSON.stringify(disk).includes(password) && !JSON.stringify(localKeys.map(k => app.loadLocalStorage(k))).includes(password)
        out.savedShot = await shot('saved-pair')
        modal.close(); modal = null
        await config.reloadSettings(); await store.load()
        modal = t.networkSecurity.reviewKeyDestinations()
        out.visiblePair = [...modal.bodyEl.querySelectorAll('[data-key-destination]')].some(row => row.textContent.includes(name) && row.textContent.includes(origin))
        const reopenedPicker = modal.bodyEl.querySelector('select[aria-label="Saved key"]')
        reopenedPicker.value = id; reopenedPicker.dispatchEvent(new Event('change', { bubbles: true }))
        out.reusableAddress = modal.bodyEl.querySelector('input[aria-label="Recipient address"]').value === origin
        out.reopenShot = await shot('reopened-pair')
        try {
          const answer = await retry()
          out.rawSuccess = answer.status === 200
          out.redacted = !answer.text.includes(password) && !answer.text.includes(basic.slice(6))
        } catch { out.rawSuccess = false; out.refusedBeforeSend = out.calls === 0 }
        const tool = t.createAgentTools().find(tool => tool.name === 'fetch')
        out.basicSchema = !!tool.parameters.properties.basicAuth
        if (out.rawSuccess && out.basicSchema) {
          const answer = await tool.execute('sample-basic-call', { url: origin + '/stats', basicAuth: { username: user, password: '\${abele_key:Grove password}' } })
          out.toolSuccess = answer.content[0].text.includes('HTTP 200') && !answer.content[0].text.includes(password) && !answer.content[0].text.includes(basic.slice(6))
        }
        const errorPicker = modal.bodyEl.querySelector('select[aria-label="Saved key"]')
        errorPicker.value = 'new'; errorPicker.dispatchEvent(new Event('change', { bubbles: true }))
        field('New key name', name); field('New key value', 'fake-unused-collision-value')
        ;[...modal.footerEl.querySelectorAll('button')].find(b => b.textContent === 'Allow key and address').click()
        await until(() => modal.bodyEl.textContent.includes('already has that name'))
        out.actionableError = !modal.bodyEl.textContent.includes('fake-unused-collision-value') && store.get(id) === password
        out.errorShot = await shot('name-collision-error')
        ;[...modal.bodyEl.querySelectorAll('button')].find(b => b.textContent === 'Remove key permission').click()
        await until(() => !modal.bodyEl.querySelector('[data-key-destination]'))
        const removed = await plugin.loadData()
        out.removalPersisted = !removed.ai.secrets.find(s => s.keyId === id).allowedOrigins.includes(origin) && store.get(id) === password
        try { await retry(); out.blockedAfterRemoval = false } catch { out.blockedAfterRemoval = true }
        out.callsAfterRemoval = out.calls
      } finally {
        modal?.close(); t.networkSecurity.setRequestTransport(undefined)
        config.ai = oldAi
        if (store.get(id) === password) { store.remove(id); await store.flush() }
        await config.saveSettings(); await config.reloadSettings()
        localKeys.forEach((k,i) => app.saveLocalStorage(k,oldLocal[i]))
      }
      return out
    })()`,
        90_000
      )
      if (raw.startsWith('Error:')) throw new Error(raw)
      const report = JSON.parse(raw)
      console.info(JSON.stringify(report))
      expect(report.blockedBefore).toBe(true)
      expect(report.callsDuringConsent).toBe(0)
      expect(report.diskPair).toEqual(['http://192.168.63.27:8786'])
      expect(report.noPlaintext).toBe(true)
      expect(report.rawSuccess).toBe(true)
      expect(report.correctHeader).toBe(true)
      expect(report.redacted).toBe(true)
      expect(report.visiblePair).toBe(true)
      expect(report.reusableAddress).toBe(true)
      expect(report.actionableError).toBe(true)
      expect(report.removalPersisted).toBe(true)
      expect(report.blockedAfterRemoval).toBe(true)
      expect(report.callsAfterRemoval).toBe(2)
      expect(report.basicSchema).toBe(true)
      expect(report.toolSuccess).toBe(true)
      expect(report.calls).toBe(2)
    }, 120_000)
  }
)
