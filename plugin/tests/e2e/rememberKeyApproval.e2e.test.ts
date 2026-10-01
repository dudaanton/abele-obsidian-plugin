import { describe, expect, it } from 'vitest'
import {
  evalRaw,
  reloadApp,
  evalLong,
  hasTestApi,
  isObsidianRunning,
  restoreDesktopWindow,
} from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { onPhone, targets } from './helpers/target'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('abele-key-approval')

describe.skipIf(!available)('remembered saved-key recipients', () => {
  it.each(onPhone() ? ['phone'] : ['desktop', 'mobile'])(
    '%s does not repeat the key question',
    async (screen) => {
      try {
        if (screen === 'mobile') {
          await reloadApp('app.emulateMobile(true)')
          evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
        }
        const raw = await evalLong(
          `(async () => {
        const api = window.__abeleTest
        const config = api.AbeleConfig.getInstance()
        const previous = config.ai
        const save = config.saveSettings
        const storageKey = 'abele-key-destinations-v1'
        const local = app.loadLocalStorage(storageKey)
        let persisted
        config.ai = { ...previous, secrets: [{ name: 'sample', keyId: 'sample-approval-key' }] }
        config.saveSettings = async () => { persisted = JSON.parse(JSON.stringify(config.ai)) }
        const request = {
          url: 'https://api.sample.example/first',
          headers: { Authorization: '\${abele_key:sample}' },
        }
        const approve = api.networkSecurity.approveScriptKeyRequest
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
        const cancel = () => document.querySelector('.abele-modal__footer button')?.click()
        try {
          const first = approve(request)
          await wait(300)
          const modal = document.querySelector('.modal.abele-modal')
          if (!modal) throw Error('initial key question did not open')
          const buttons = [...modal.querySelectorAll('button')]
          const outside = buttons.filter(button => {
            const r = button.getBoundingClientRect()
            return r.width <= 0 || r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight
          }).map(button => button.textContent)
          const text = modal.textContent
          const shot = ${JSON.stringify(shots + '/' + screen + '.png')}
          let saved
          if (window.__e2eHost) saved = await window.__e2eHost.shot(shot)
          else {
            const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
            require('fs').writeFileSync(shot, image.toPNG()); saved = shot
          }
          buttons.find(button => button.textContent === 'Allow address and send').click()
          await first
          const allowed = persisted?.secrets[0].allowedOrigins
          // Re-read the saved settings rather than relying on the dialog's config object.
          config.ai = persisted
          const next = approve({ ...request, url: 'https://API.SAMPLE.EXAMPLE:443/next?q=2' })
          const repeated = !!document.querySelector('.modal')
          if (repeated) cancel()
          const nextError = await next.then(() => '', error => error.message)
          const other = approve({ ...request, url: 'https://other.example/next' })
          const otherAsked = !!document.querySelector('.modal')
          const refused = other.then(() => false, () => true)
          cancel()
          const otherRefused = await refused
          return { allowed, repeated, nextError, otherAsked, otherRefused, outside, text, shot: saved }
        } finally {
          cancel()
          config.ai = previous
          config.saveSettings = save
          app.saveLocalStorage(storageKey, local)
        }
      })()`,
          60_000
        )
        if (raw.startsWith('Error:')) throw Error(raw)
        const result = JSON.parse(raw)
        expect(result.allowed).toEqual(['https://api.sample.example'])
        expect(result.repeated).toBe(false)
        expect(result.nextError).toBe('')
        expect(result.otherAsked).toBe(true)
        expect(result.otherRefused).toBe(true)
        expect(result.outside).toEqual([])
        expect(result.text).toContain('will not ask again on this device')
        expect(result.shot).not.toMatch(/^no picture:/)
        console.info(result.shot)
      } finally {
        if (screen === 'mobile') await restoreDesktopWindow()
      }
    },
    90_000
  )
})
