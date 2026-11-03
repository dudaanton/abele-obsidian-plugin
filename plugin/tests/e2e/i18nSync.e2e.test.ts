import { describe, expect, it } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { WAIT_PRELUDE } from './helpers/wait'

const shots = shotDir('i18n-sync')

describe.skipIf(!isObsidianRunning() || !hasTestApi())('localized sync layouts', () => {
  it('keeps connection controls and QR instructions inside desktop and phone dialogs', async () => {
    async function check(phone: boolean) {
      for (const locale of ['ru', 'en-XA']) {
        const result = JSON.parse(
          await evalLong(
            `(async () => {
          ${WAIT_PRELUDE}
          const api = window.__abeleTest
          await api.setTestLocale(${JSON.stringify(locale)})
          const fs = require('fs')
          fs.mkdirSync(${JSON.stringify(shots)}, { recursive: true })
          const win = require('@electron/remote').getCurrentWindow()
          const failures = []
          const capture = async (name, root) => {
            await new Promise(resolve => setTimeout(resolve, 400))
            for (const el of [root, ...root.querySelectorAll('.setting-item, .abele-modal__footer')]) {
              const r = el.getBoundingClientRect()
              if (r.width && (r.left < -1 || r.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 2))
                failures.push({ name, cls: el.className, left: r.left, right: r.right, width: el.clientWidth, scroll: el.scrollWidth })
            }
            fs.writeFileSync(${JSON.stringify(shots + '/' + locale + (phone ? '-phone-' : '-desktop-'))} + name + '.png', (await win.webContents.capturePage()).toPNG())
          }
          const close = async (modal = [...document.querySelectorAll('.modal.abele-modal')].at(-1)) => {
            modal?.closest('.modal-container')?.querySelector('.modal-close-button, .modal-header-button:has(svg.lucide-x)')?.click()
            if (modal && !await until(() => !modal.isConnected)) throw new Error('Sync fixture did not close')
          }
          try {
            const previous = new Set(document.querySelectorAll('.modal.abele-modal'))
            api.openDialog('sync-connect')
            const connect = await until(() => [...document.querySelectorAll('.modal.abele-modal')].find(one => !previous.has(one)))
            if (!connect) throw new Error('Connect dialog did not mount')
            await capture('qr', connect)
            const instructions = [...connect.querySelectorAll('.setting-item-name')].map(el => el.textContent.trim())
            if (!instructions.some(text => text.includes(${JSON.stringify(locale === 'ru' ? 'Считать QR-код' : 'ɊŔ')})))
              throw new Error('Localized QR instructions are missing: ' + instructions.join('; '))
            await close(connect)
            api.openDialog('sync-connections')
            const connections = await until(() => [...document.querySelectorAll('.modal.abele-modal')].find(one => !previous.has(one)))
            const row = await until(() => connections?.querySelector('.abele-sync-row'))
            if (!row) throw new Error('Connection row did not mount')
            const windows = new Set(document.querySelectorAll('.abele-sync-window'))
            row.click()
            // Native phone dialogs may be inserted before the existing modal.
            // Observe the window this gesture mounted, independent of DOM order.
            const content = await until(() => [...document.querySelectorAll('.abele-sync-window')].find(one => !windows.has(one)))
            if (!content) throw new Error('Connection window did not mount: ' + JSON.stringify({
              fixtureConnected: connections.isConnected, rowConnected: row.isConnected,
              rowText: row.textContent, rowDocument: row.ownerDocument === document,
              modals: [...document.querySelectorAll('.modal')].map(one => ({
                title: one.querySelector('.modal-title')?.textContent,
                settings: !!one.querySelector('.token-sync-settings'), window: !!one.querySelector('.abele-sync-window')
              }))
            }))
            await capture('connection', content.closest('.modal'))
            const last = content.closest('.modal').querySelector('.abele-modal__footer button:last-child')
            if (!last) throw new Error('Connection actions did not mount')
            last.scrollIntoView({ block: 'nearest' })
            await capture('connection-footer', content.closest('.modal'))
            return JSON.stringify(failures)
          } finally {
            for (let i = 0; i < 3 && document.querySelector('.modal.abele-modal'); i++) await close()
            await api.setTestLocale('en')
          }
        })()`,
            60_000
          )
        ) as unknown[]
        expect(result, `${locale} ${phone ? 'phone' : 'desktop'}`).toEqual([])
      }
    }
    try {
      await check(false)
      await withEmulatedPhone(() => check(true))
    } finally {
      evalRaw(`window.__abeleTest?.setTestLocale('en')`)
      await reloadApp('app.emulateMobile(false)')
    }
  }, 240_000)
})
