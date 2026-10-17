import { describe, expect, it } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { WAIT_PRELUDE } from './helpers/wait'

const shots = shotDir('i18n-tasks-finance')

describe.skipIf(!isObsidianRunning() || !hasTestApi())('localized task and finance layouts', () => {
  it('renders Russian and expanded prose on desktop and phone without horizontal overflow', async () => {
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
          const layout = app.workspace.getLayout()
          const ownedLeaves = []
          const capture = async (name, root) => {
            await new Promise(resolve => setTimeout(resolve, 350))
            const bounds = root.getBoundingClientRect()
            if (bounds.left < -1 || bounds.right > innerWidth + 1 || root.scrollWidth > root.clientWidth + 2)
              failures.push({ name, left: bounds.left, right: bounds.right, width: root.clientWidth, scroll: root.scrollWidth })
            fs.writeFileSync(${JSON.stringify(shots + '/' + locale + (phone ? '-phone-' : '-desktop-'))} + name + '.png', (await win.webContents.capturePage()).toPNG())
          }
          try {
          for (const name of ['date', 'recurrence', 'date-range']) {
            api.openDialog(name)
            const modal = await until(() => document.querySelector('.modal.abele-modal'))
            if (!modal) throw new Error(name + ' did not mount')
            try {
              await capture(name, modal)
              if (name === 'recurrence') {
                const unit = modal.querySelector('.abele-recurrence-picker select')
                if (!unit) throw new Error('Recurrence interval selector did not mount')
                unit.value = 'month'
                unit.dispatchEvent(new Event('change', { bubbles: true }))
                const modes = await until(() => modal.querySelector('.abele-recurrence-picker__month-modes'))
                if (!modes) throw new Error('Monthly recurrence controls did not mount')
                await capture('recurrence-month-days', modal)
                modes.querySelectorAll('.abele-obsidian-icon')[1].click()
                const weekday = await until(() => modal.querySelectorAll('.abele-recurrence-picker__positional select')[1])
                if (!weekday) throw new Error('Monthly weekday selector did not mount')
                weekday.value = '3'
                weekday.dispatchEvent(new Event('change', { bubbles: true }))
                await capture('recurrence-month-weekday', modal)
                unit.value = 'week'
                unit.dispatchEvent(new Event('change', { bubbles: true }))
                await capture('recurrence-week', modal)
              }
              const last = modal.querySelector('.abele-modal__footer button:last-child, .modal-button-container button:last-child')
              if (last) {
                last.scrollIntoView({ block: 'nearest' })
                await capture(name + '-footer', modal)
              }
            } finally {
              document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
              if (!await until(() => !document.querySelector('.modal.abele-modal'))) throw new Error(name + ' did not close')
            }
          }
          for (const [type, selector] of [
            ['abele-finance-sidebar-view', '.abele-finance-sidebar'],
            ['abele-todo-sidebar-view', '.abele-todo-list'],
            ['abele-time-tracking-sidebar-view', '.abele-time-tracking-sidebar'],
          ]) {
            const leaf = app.workspace.getLeaf('tab')
            ownedLeaves.push(leaf)
              await leaf.setViewState({ type, active: true })
              app.workspace.setActiveLeaf(leaf, { focus: true })
              const root = await until(() => leaf.view.containerEl.querySelector(selector))
              if (!root) throw new Error(type + ' did not mount')
              await capture(type, root)
          }
          const folder = 'I18nSampleLayouts'
          if (app.vault.getAbstractFileByPath(folder)) throw new Error('The synthetic layout folder already exists')
          await app.vault.createFolder(folder)
          try {
            const now = new Date()
            const day = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
            const task = await app.vault.create(folder + '/Sample task.md', '---\\n' + 'type: task\\ndate: ' + day + '\\ndue: ' + day + '\\n---\\nSample task\\n')
            await app.vault.create(folder + '/Sample person.md', '---\\nborn: 1900\\ndied: 1980\\ngroup: Sample group\\n---\\n')
            if (!await until(() => app.metadataCache.getFileCache(task)?.frontmatter?.date)) throw new Error('Synthetic metadata did not index')
            for (const [type, selector] of [['abele-calendar', '.abele-calendar-base'], ['abele-timeline', '.abele-timeline-base']]) {
              const file = await app.vault.create(folder + '/' + type + '.base', 'filters:\\n  and:\\n    - file.inFolder("' + folder + '")\\nviews:\\n  - type: ' + type + '\\n    name: Sample view\\n')
              const leaf = app.workspace.getLeaf('tab')
              ownedLeaves.push(leaf)
                await leaf.openFile(file)
                app.workspace.setActiveLeaf(leaf, { focus: true })
                const root = await until(() => leaf.view.containerEl.querySelector(selector))
                if (!root) throw new Error(type + ' did not mount')
                await capture(type, root)
            }
          } finally {
            const made = app.vault.getAbstractFileByPath(folder)
            if (made) await app.vault.delete(made, true)
          }
          return JSON.stringify(failures)
          } finally {
            for (const leaf of ownedLeaves) leaf.detach()
            await app.workspace.changeLayout(layout)
          }
        })()`,
            90_000
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
  }, 300_000)
})
