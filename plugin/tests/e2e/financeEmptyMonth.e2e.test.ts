import { describe, expect, it } from 'vitest'
import { enterPhone, evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const shots = shotDir('finance-empty-month')

describe.each(onPhone() ? ['phone'] : ['desktop', 'emulated-phone'])(
  'finance charts in an empty month on %s',
  (mode) => {
    it('keeps every chart tab available and captures each empty-month state', async () => {
      const size =
        mode === 'emulated-phone'
          ? (JSON.parse(
              evalRaw(
                `JSON.stringify(require('@electron/remote').getCurrentWindow().getContentSize())`
              )
            ) as number[])
          : undefined
      try {
        if (mode === 'emulated-phone') await enterPhone(390, 844)
        const result = JSON.parse(
          await evalLong(
            `(async () => {
          const ws = app.workspace
          const folder = 'SampleEmptyMonth'
          const config = window.__abeleTest.AbeleConfig.getInstance()
          const oldPinned = config.pinnedCurrencies
          const layout = ws.getLayout()
          const currency = 'XTS'
          const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
          const until = async (read, label) => {
            const end = Date.now() + 30000
            while (Date.now() < end) { if (read()) return; await wait(100) }
            throw Error(label)
          }
          const note = fields => '---\\n' + Object.entries(fields).map(([k,v]) => k + ': ' + JSON.stringify(v)).join('\\n') + '\\n---\\n'
          let leaf
          let created = false
          try {
            if (app.vault.getAbstractFileByPath(folder)) throw Error('Fixture folder already exists')
            await app.vault.createFolder(folder)
            created = true
            config.pinnedCurrencies = currency
            const now = new Date()
            const previous = new Date(now.getFullYear(), now.getMonth() - 1, 15)
            const date = previous.getFullYear() + '-' + String(previous.getMonth()+1).padStart(2,'0') + '-15'
            const files = {
              'Wallet': { type: 'account', accountType: 'asset', currency, startingBalance: 100, startingBalanceDate: date },
              'Spending': { type: 'account', accountType: 'expense' },
              'Earlier purchase': { type: 'transaction', date, from: '[[' + folder + '/Wallet]]', to: '[[' + folder + '/Spending]]', amount: 10, currency },
            }
            for (const [name, fields] of Object.entries(files)) await app.vault.create(folder + '/' + name + '.md', note(fields))
            leaf = ${JSON.stringify(mode !== 'desktop')} ? ws.getLeaf('tab') : ws.getRightLeaf(true)
            await leaf.setViewState({ type: 'abele-finance-sidebar-view', active: true })
            if (${JSON.stringify(mode !== 'desktop')}) { ws.leftSplit.collapse(); ws.rightSplit.collapse() }
            else ws.rightSplit.expand()
            await ws.revealLeaf(leaf)
            const root = () => leaf.view.containerEl.querySelector('.abele-finance-sidebar')
            await until(() => root()?.querySelector('.abele-finance-sidebar__currency-tabs [data-tab-id="XTS"]'), 'Missing fixture currency')
            root().querySelector('.abele-finance-sidebar__currency-tabs [data-tab-id="XTS"]').click()
            await until(() => root()?.querySelector('.abele-finance-sidebar__pie-empty'), 'Missing empty-period pie state')
            const captures = []
            for (const tab of ['expenses', 'income', 'calendar', 'networth']) {
              const button = root().querySelector('.abele-finance-sidebar__chart-tabs [data-tab-id="' + tab + '"]')
              if (!button) throw Error('Missing tab: ' + tab)
              button.click()
              const selector = tab === 'calendar' ? '.abele-finance-sidebar__calendar-chart canvas' : tab === 'networth' ? '.abele-finance-sidebar__networth-chart canvas' : '.abele-finance-sidebar__pie-empty'
              await until(() => root().querySelector(selector), 'Missing chart: ' + tab)
              root().querySelector(selector).scrollIntoView({ block: 'center' })
              await wait(500)
              if (!root().querySelector(selector).checkVisibility()) throw Error('Hidden chart: ' + tab)
              const path = ${JSON.stringify(shots + '/' + mode + '-')} + tab + '.png'
              if (window.__e2eHost) await window.__e2eHost.shot(path)
              else require('fs').writeFileSync(path, (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())
              captures.push(path)
            }
            return JSON.stringify({ error: '', captures })
          } finally {
            leaf?.detach()
            config.pinnedCurrencies = oldPinned
            if (created) { const dir = app.vault.getAbstractFileByPath(folder); if (dir) await app.vault.delete(dir, true) }
            await ws.changeLayout(layout)
          }
        })().catch(error => JSON.stringify({ error: String(error), captures: [] }))`,
            180000
          )
        ) as { error: string; captures: string[] }
        expect(result.error).toBe('')
        expect(result.captures).toHaveLength(4)
      } finally {
        if (size) {
          await reloadApp('app.emulateMobile(false)')
          evalRaw(
            `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`
          )
        }
      }
    })
  }
)
