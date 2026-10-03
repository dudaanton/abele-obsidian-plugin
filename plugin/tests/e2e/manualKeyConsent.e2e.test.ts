import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop', 'phone')
const shots = shotDir('abele-manual-key-consent')
const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('native manual key consent with mock transport', () => {
  it('saves a protected key, approves just its recipient and retries the unchanged literal script', async () => {
    const raw = await evalLong(
      `(async () => {
      const t = window.__abeleTest
      const config = t.AbeleConfig.getInstance()
      const store = t.secrets()
      const oldAi = config.ai
      const storageKeys = ['abele-key-destinations-v1', 'abele-key-http-origins-v1']
      const oldLocal = storageKeys.map(key => app.loadLocalStorage(key))
      const origin = 'http://192.168.42.12:8123'
      const value = 'fake-native-key-material'
      let modal, keyId, calls = 0
      const out = {}
      const wait = ms => new Promise(r => setTimeout(r, ms))
      const until = async fn => {
        const deadline = Date.now() + 10000
        while (Date.now() < deadline) { if (fn()) return; await wait(50) }
        throw Error('Sample consent operation did not settle')
      }
      const shot = async name => {
        // Native modal DOM can settle before the compositor has painted its first frame.
        await wait(250)
        const path = ${JSON.stringify(shots)} + '/' + name + '.png'
        if (window.__e2eHost) return window.__e2eHost.shot(path)
        const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
        require('fs').writeFileSync(path, image.toPNG())
        return path
      }
      const field = (label, value) => {
        const input = modal.bodyEl.querySelector('input[aria-label="' + label + '"]')
        input.value = value
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const fetchLiteral = () => t.networkSecurity.buildScriptContext({ params: {}, signal: new AbortController().signal, logs: [] })
        .fetch(origin + '/status', { headers: { Authorization: 'Bearer ' + value } })
      try {
        config.ai = { ...oldAi, providers: [], imageProviders: [], secrets: [], mcpServers: [], braveSearchApiKey: '',
          voice: { ...oldAi.voice, apiKeyId: 'abele-openrouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions' } }
        app.saveLocalStorage(storageKeys[0], { 'abele-openrouter': ['https://openrouter.ai'] })
        app.saveLocalStorage(storageKeys[1], [])
        t.networkSecurity.setRequestTransport(async request => {
          calls++
          out.literalUnchanged = request.headers.Authorization === 'Bearer ' + value
          return { status: 200, headers: { 'content-type': 'text/plain' }, text: value, arrayBuffer: new ArrayBuffer(0) }
        })
        try { await fetchLiteral(); out.blockedBefore = false } catch { out.blockedBefore = true }
        out.callsBefore = calls
        modal = t.networkSecurity.reviewKeyDestinations()
        out.empty = !modal.bodyEl.querySelector('[data-key-destination]')
        field('Recipient address', origin + '/status')
        const picker = modal.bodyEl.querySelector('select')
        picker.value = 'new'
        picker.dispatchEvent(new Event('change', { bubbles: true }))
        field('New key name', 'Sample native key')
        field('New key value', value)
        out.masked = modal.bodyEl.querySelector('input[aria-label="New key value"]').type === 'password'
        out.summary = modal.footerEl.textContent.includes('Sample native key') && modal.footerEl.textContent.includes(origin) && modal.footerEl.textContent.includes('Unencrypted')
        out.secretAbsentFromText = !modal.modalEl.textContent.includes(value)
        out.outside = []
        out.ringCuts = []
        for (const control of modal.modalEl.querySelectorAll('input, select, button')) {
          const r = control.getBoundingClientRect()
          if (!r.width) continue
          if (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) out.outside.push(control.getAttribute('aria-label') || control.textContent)
          control.focus()
          const cs = getComputedStyle(control)
          const nums = (cs.boxShadow.match(/-?\\d+(\\.\\d+)?px/g) || []).map(parseFloat)
          const shadow = nums.length >= 4 ? Math.max(0, nums[2]) + Math.max(0, nums[3]) : 0
          const outline = cs.outlineStyle !== 'none' ? parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset || '0') : 0
          const reach = Math.max(shadow, outline)
          for (let el = control.parentElement; reach > 0 && el && el !== document.documentElement; el = el.parentElement) {
            const s = getComputedStyle(el)
            if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
            const b = el.getBoundingClientRect(), left = b.left + el.clientLeft
            if (Math.max(left - (r.left - reach), r.right + reach - left - el.clientWidth) > .5) out.ringCuts.push(control.getAttribute('aria-label') || control.textContent)
          }
          control.blur()
        }
        out.formShot = await shot('new-key-masked')
        ;[...modal.footerEl.querySelectorAll('button')].find(b => b.textContent === 'Allow key and address').click()
        await until(() => modal.bodyEl.textContent.includes('Retry the original script'))
        const key = config.ai.secrets.find(s => s.name === 'Sample native key')
        keyId = key.keyId
        out.exactProtectedValue = store.get(keyId) === value
        out.pair = key.allowedOrigins
        out.secretAbsentFromSettings = !JSON.stringify(config.exportSettings()).includes(value)
        out.secretAbsentFromLocal = !JSON.stringify(storageKeys.map(k => app.loadLocalStorage(k))).includes(value)
        out.callsAfterConsent = calls
        const result = await fetchLiteral()
        out.retry = result.status === 200 && result.text === '[saved key]'
        out.callsAfterRetry = calls
        out.allowedShot = await shot('recipient-allowed')
        ;[...modal.bodyEl.querySelectorAll('button')].find(b => b.textContent === 'Remove HTTP exception').click()
        try { await fetchLiteral(); out.blockedAfterRemoval = false } catch { out.blockedAfterRemoval = true }
        out.callsAfterRemoval = calls
      } finally {
        modal?.close()
        t.networkSecurity.setRequestTransport(undefined)
        // Only the unique key created by this fixture is ours to remove.
        if (!keyId) keyId = config.ai.secrets.find(s => s.name === 'Sample native key')?.keyId
        config.ai = oldAi
        if (keyId && store.get(keyId) === value) { store.remove(keyId); await store.flush() }
        await config.saveSettings()
        storageKeys.forEach((key, i) => app.saveLocalStorage(key, oldLocal[i]))
      }
      return out
    })()`,
      90_000
    )
    if (raw.startsWith('Error:')) throw new Error(raw)
    const report = JSON.parse(raw)
    expect(report.blockedBefore).toBe(true)
    expect(report.callsBefore).toBe(0)
    expect(report.empty).toBe(true)
    expect(report.masked).toBe(true)
    expect(report.summary).toBe(true)
    expect(report.secretAbsentFromText).toBe(true)
    expect(report.outside).toEqual([])
    expect(report.ringCuts).toEqual([])
    expect(report.exactProtectedValue).toBe(true)
    expect(report.pair).toEqual(['http://192.168.42.12:8123'])
    expect(report.secretAbsentFromSettings).toBe(true)
    expect(report.secretAbsentFromLocal).toBe(true)
    expect(report.callsAfterConsent).toBe(0)
    expect(report.literalUnchanged).toBe(true)
    expect(report.retry).toBe(true)
    expect(report.callsAfterRetry).toBe(1)
    expect(report.blockedAfterRemoval).toBe(true)
    expect(report.callsAfterRemoval).toBe(1)
    console.info(report.formShot, report.allowedShot)
  }, 120_000)
})
