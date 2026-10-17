import { describe, expect, it } from 'vitest'
import { evalLong, evalRaw, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { WAIT_PRELUDE } from './helpers/wait'

const locales = ['en', 'en-XA', 'ru', 'de', 'lv', 'es']
const probe = (locale: string, phone: boolean) => `(async () => {
  ${WAIT_PRELUDE}
  // The phone host retains the active tab when its settings sheet closes. Flush our
  // tab's unmount before changing a reload-bound locale, then display it explicitly.
  app.setting.activeTab?.hide?.()
  app.setting.close()
  await window.__abeleTest.setTestLocale(${JSON.stringify(locale)})
  app.setting.open()
  app.setting.openTabById('abele')
  if (app.setting.activeTab?.id === 'abele') app.setting.activeTab.display()
  const root = await until(() => app.setting.activeTab?.containerEl.querySelector('.abele-settings__nav'))
  if (!root) throw new Error('Settings navigation did not mount')
  const d = root.ownerDocument
  const frame = () => new Promise(resolve => {
    const timer = setTimeout(resolve, 250)
    d.defaultView.requestAnimationFrame(() => { clearTimeout(timer); resolve() })
  })
  const settle = async (el = root) => {
    let previous = ''
    let same = 0
    const ready = await until(async () => {
      await frame()
      const r = el.getBoundingClientRect()
      const current = [r.top, r.bottom, r.left, r.right, el.scrollTop].join(' ')
      same = current === previous ? same + 1 : 0
      previous = current
      return same >= 3
    }, 5000, 0)
    if (!ready) throw new Error('Settings geometry did not settle')
  }
  await settle()
  const labels = [...root.querySelectorAll('.abele-tabs__tab')].map(el => el.textContent.trim())
  const over = [...root.querySelectorAll('.abele-tabs__tab, .abele-tabs__label, .abele-settings__group')].filter(el => {
    const rect = el.getBoundingClientRect()
    return rect.right > root.getBoundingClientRect().right + 1 || el.scrollWidth > el.clientWidth + 1
  }).map(el => el.textContent.trim())
  const { remote } = require('electron')
  const w = remote.BrowserWindow.getAllWindows().find(w => w.getTitle().startsWith('Settings - ' + app.vault.getName() + ' - ')) || remote.getCurrentWindow()
  const fs = require('fs')
  fs.mkdirSync(${JSON.stringify(shotDir('i18n-settings'))}, { recursive: true })
  const shoot = async suffix => fs.writeFileSync(${JSON.stringify(shotDir('i18n-settings'))} + '/' + ${JSON.stringify(locale + (phone ? '-phone' : '-desktop'))} + suffix + '.png', (await w.webContents.capturePage()).toPNG())
  await shoot('-top')
  let endVisible = true
  let geometry = []
  if (${phone}) {
    const last = [...root.querySelectorAll('.abele-tabs__tab')].at(-1)
    last.scrollIntoView({ block: 'end', behavior: 'instant' })
    await settle(last)
    const bounds = last.getBoundingClientRect()
    endVisible = bounds.top >= 0 && bounds.bottom <= d.defaultView.innerHeight + 1
    for (let el = last; el; el = el.parentElement) {
      const rect = el.getBoundingClientRect()
      geometry.push({ cls: el.className, top: rect.top, bottom: rect.bottom, height: el.clientHeight, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, overflow: d.defaultView.getComputedStyle(el).overflowY })
    }
    await shoot('-bottom')
  }
  app.setting.close()
  return JSON.stringify({ labels, over, endVisible, geometry })
})()`

describe.skipIf(!isObsidianRunning())('translated Settings navigation', () => {
  it('keeps the English baseline and fits every pilot language on desktop and phone', async () => {
    async function check(phone: boolean) {
      for (const locale of locales) {
        const result = JSON.parse(await evalLong(probe(locale, phone), 60_000)) as {
          labels: string[]
          over: string[]
          endVisible: boolean
          geometry: unknown[]
        }
        expect(result.labels).toHaveLength(18)
        expect(result.over, `${locale} ${phone ? 'phone' : 'desktop'}`).toEqual([])
        expect(
          result.endVisible,
          `${locale}: last page is reachable: ${JSON.stringify(result.geometry)}`
        ).toBe(true)
        if (locale === 'en')
          expect(result.labels).toEqual([
            'Tasks',
            'Journals',
            'Calendars',
            'Links',
            'Linter',
            'Books',
            'Finance',
            'Time Tracking',
            'AI Agent',
            'Scripts',
            'Nodes',
            'GitHub',
            'Quick button',
            'Header buttons',
            'Sync',
            'Transfer',
            'Logs',
            'Other',
          ])
        if (locale === 'en-XA')
          expect(result.labels.filter((label) => !label.startsWith('⟦'))).toEqual([])
        if (locale === 'ru') expect(result.labels[0]).toBe('Задачи')
      }
    }
    try {
      await check(false)
      await withEmulatedPhone(() => check(true))
    } finally {
      evalRaw(`app.setting.close(); window.__abeleTest?.setTestLocale('en')`)
      await reloadApp('app.emulateMobile(false)')
    }
  }, 240_000)
})
