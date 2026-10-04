import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
import { settledGeometry } from '../helpers/settledGeometry'
import { outwardBoxShadowReach } from '../helpers/focusRingPaint'
import { nativeGesture } from '../helpers/nativeGesture'

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
        out.geometry = []
        let wholeHeight = innerHeight
        if (Math.abs(screen.width - innerWidth) < 2) wholeHeight = Math.max(wholeHeight, screen.height)
        const rect = el => { const r = el.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width} }
        const primary = () => [...modal.footerEl.querySelectorAll('button')].find(b => b.textContent === 'Allow key and address')
        // Native Modal.open schedules its own initial focus. Let that actual opening finish
        // before deliberately focusing another control; otherwise it steals that focus later.
        out.opening = await (${settledGeometry.toString()})(() => ({
          modal:rect(modal.modalEl),primary:rect(primary()),
          active:[...modal.modalEl.querySelectorAll('input,select,button')].indexOf(document.activeElement),
          viewport:[innerWidth,innerHeight,visualViewport?.height,visualViewport?.offsetTop],
          keyboard:getComputedStyle(document.documentElement).getPropertyValue('--keyboard-height'),
        }), () => wait(50), Date.now)
        for (const control of modal.modalEl.querySelectorAll('input, select, button')) {
          if (!control.getBoundingClientRect().width) continue
          const label = control.getAttribute('aria-label') || control.textContent
          // Obsidian adds an aria-hidden SELECT solely to size the real dropdown.
          // Keep its geometry checks, but do not fabricate focus on that sizing copy.
          const sizingCopy = control.matches('select.is-measuring[aria-hidden="true"]')
          if (!sizingCopy) control.focus()
          if (window.__e2eHost && control.tagName === 'INPUT') {
            // One actual native tap, never replayed, brings the real keyboard to the focused field.
            control.scrollIntoView({block:'center'})
            const at = control.getBoundingClientRect()
            await (${nativeGesture.toString()})(() => window.__e2eHost.tap(at.left + at.width/2, at.top + at.height/2))
          }
          const read = () => {
            const viewport = visualViewport
            const keyboard = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-height')) || 0
            wholeHeight = Math.max(wholeHeight, innerHeight)
            const cs = getComputedStyle(control)
            const shadow = (${outwardBoxShadowReach.toString()})(cs.boxShadow)
            const outline = cs.outlineStyle !== 'none' ? parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset || '0') : 0
            const reach = Math.max(shadow, outline)
            const r = rect(control), cuts = []
            for (let el = control.parentElement; reach > 0 && el && el !== document.documentElement; el = el.parentElement) {
              const s = getComputedStyle(el)
              if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
              const b = el.getBoundingClientRect(), left = b.left + el.clientLeft
              if (Math.max(left - (r.left - reach), r.right + reach - left - el.clientWidth) > .5) cuts.push(label)
            }
            return {label,focused:document.activeElement === control,field:r,primary:rect(primary()),modal:rect(modal.modalEl),reach,cuts,keyboard,
              viewport:{left:viewport?.offsetLeft||0,top:viewport?.offsetTop||0,right:Math.min(innerWidth,(viewport?.offsetLeft||0)+(viewport?.width||innerWidth)),
                bottom:Math.min(innerHeight,(viewport?.offsetTop||0)+(viewport?.height||innerHeight),keyboard>0?wholeHeight-keyboard+(viewport?.offsetTop||0):innerHeight)}}
          }
          const geometry = await (${settledGeometry.toString()})(read, () => wait(50), Date.now)
          if (!sizingCopy && !geometry.focused) throw Error('Sample consent control lost actual focus: ' + JSON.stringify({label,tag:control.tagName,disabled:control.disabled,connected:control.isConnected,ownerSame:control.ownerDocument===document,activeTag:document.activeElement?.tagName,activeLabel:document.activeElement?.getAttribute('aria-label'),geometry}))
          geometry.kind = sizingCopy ? 'native-sizing-copy' : 'focused-control'
          out.geometry.push(geometry)
          const viewport = geometry.viewport
          for (const [name, r] of [[label,geometry.field],['Allow key and address',geometry.primary]]) {
            if (r.left < viewport.left || r.right > viewport.right || r.top < viewport.top || r.bottom > viewport.bottom) out.outside.push(name)
          }
          out.ringCuts.push(...geometry.cuts)
          const r = geometry.field, reach = geometry.reach
          if (r.left-reach < viewport.left || r.right+reach > viewport.right || r.top-reach < viewport.top || r.bottom+reach > viewport.bottom) out.ringCuts.push(label)
          if (window.__e2eHost && control.tagName === 'INPUT') out.geometry[out.geometry.length-1].shot = await shot('focus-' + label.toLowerCase().replace(/[^a-z0-9]+/g,'-'))
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
    console.info('manual consent focused geometry', JSON.stringify(report.geometry))
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
