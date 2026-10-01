import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')

const FOLDER = 'SampleFinanceLifecycle'
const STATE = '__sampleFinanceLifecycle'
const SHOTS = shotDir('finance-lifecycle')
const path = (name: string) => `${FOLDER}/${name}.md`

async function probe<T>(body: string): Promise<T> {
  const result = await evalLong(`(async () => {
    const p = window.${STATE}
    const store = window.__abeleTest.GlobalStore.getInstance()
    const config = window.__abeleTest.AbeleConfig.getInstance()
    const until = async (read, expected) => {
      const end = Date.now() + 15000
      let value
      do {
        value = read()
        if (JSON.stringify(value) === JSON.stringify(expected)) return value
        await new Promise(r => setTimeout(r, 100))
      } while (Date.now() < end)
      throw new Error('Expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(value))
    }
    ${body}
  })()`)
  if (result.startsWith('Error:')) throw new Error(result)
  return JSON.parse(result) as T
}

describe.each(onPhone() ? ['phone'] : ['desktop', 'emulated-phone'])(
  'finance metadata lifecycle on %s',
  (mode) => {
    let size: number[] | undefined
    beforeAll(async () => {
      if (mode === 'emulated-phone') {
        size = JSON.parse(
          evalRaw(`JSON.stringify(require('@electron/remote').getCurrentWindow().getContentSize())`)
        )
        await reloadApp('app.emulateMobile(true)')
        evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390,844); 'sized'`)
        await reloadApp()
      }
      await probe(`
      if (app.vault.getAbstractFileByPath('${FOLDER}')) throw new Error('Fixture already exists')
      const ws = app.workspace
      window.${STATE} = { collapsed: ws.rightSplit.collapsed, leaf: null, pinned: config.pinnedCurrencies }
      const state = window.${STATE}
      config.pinnedCurrencies = 'XTS'
      for (const dir of ['${FOLDER}', '${FOLDER}/SampleA', '${FOLDER}/SampleB']) {
        await app.vault.createFolder(dir)
      }
      const today = window.moment().format('YYYY-MM-DD')
      const note = (fm) => '---\\n' + Object.entries(fm)
        .map(([k, v]) => k + ': ' + JSON.stringify(v)).join('\\n') + '\\n---\\n'
      for (const folder of ['SampleA', 'SampleB']) {
        await app.vault.create('${FOLDER}/' + folder + '/Sample wallet.md', note({
          type: 'account', accountType: 'asset', currency: 'XTS', startingBalance: 100
        }))
        await app.vault.create('${FOLDER}/' + folder + '/Sample category.md', note({
          type: 'account', accountType: folder === 'SampleA' ? 'expense' : 'liability', currency: 'XTS'
        }))
        await app.vault.create('${FOLDER}/' + folder + '/Sample spend.md', note({
          type: 'transaction', date: today, from: '[[Sample wallet]]', to: '[[Sample category]]',
          amount: folder === 'SampleA' ? 5 : 7, currency: 'XTS'
        }))
      }
      state.leaf = ws.getRightLeaf(false)
      await state.leaf.setViewState({ type: 'abele-finance-sidebar-view', active: true })
      ws.rightSplit.expand()
      await ws.revealLeaf(state.leaf)
      state.root = () => state.leaf.view.containerEl.querySelector('.abele-finance-sidebar')
      state.count = () => [...(state.root()?.querySelectorAll('.abele-transaction-view__currency') || [])]
        .filter(el => el.textContent.trim() === 'XTS').length
      state.summary = label => [...(state.root()?.querySelectorAll('.abele-finance-sidebar__summary-row') || [])]
        .find(el => el.querySelector('.abele-finance-sidebar__summary-label')?.textContent.trim() === label)
        ?.querySelector('.abele-finance-sidebar__summary-value')?.textContent.trim() || null
      await until(state.count, 2)
      return JSON.stringify(true)
    `)
    })

    afterAll(async () => {
      await probe(`
      if (p) {
        p.leaf?.detach()
        config.pinnedCurrencies = p.pinned
        if (p.collapsed) app.workspace.rightSplit.collapse()
        else app.workspace.rightSplit.expand()
        const folder = app.vault.getAbstractFileByPath('${FOLDER}')
        if (folder) await app.vault.delete(folder, true)
        delete window.${STATE}
      }
      return JSON.stringify(true)
    `)
      expect(evalRaw(`String(!!app.vault.getAbstractFileByPath('${FOLDER}'))`)).toBe('false')
      if (size) {
        evalRaw(
          `require('@electron/remote').getCurrentWindow().setContentSize(${size.join(',')}); 'restored'`
        )
        await reloadApp('app.emulateMobile(false)')
      }
    })

    it('resolves duplicate account links in the displayed totals just like balances', async () => {
      const result = await probe<{ expenses: string; lent: string; balances: number[] }>(`
      await until(() => p.summary('Expenses'), '5.00')
      await until(() => p.summary('Lent'), '7.00')
      const date = store.transactionsList.value.transactions.get('${path('SampleA/Sample spend')}').date
      const shot = ${JSON.stringify(SHOTS)} + '/${mode}.png'
      if (window.__e2eHost) await window.__e2eHost.shot(shot)
      else {
        const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
        require('fs').writeFileSync(shot, image.toPNG())
      }
      return JSON.stringify({ expenses: p.summary('Expenses'), lent: p.summary('Lent'), balances:
        ['SampleA', 'SampleB'].map(folder => store.balanceIndex.value.getBalanceAtDate('${FOLDER}/' + folder + '/Sample wallet.md', date))
      })
    `)
      expect(result).toEqual({ expenses: '5.00', lent: '7.00', balances: [95, 93] })
    })

    it('removes a retyped transaction from the displayed ledger and wallet balance', async () => {
      const result = await probe<{ count: number; balance: number; loaded: boolean }>(`
      const tx = store.transactionsList.value.transactions.get('${path('SampleA/Sample spend')}')
      const date = tx.date
      await app.fileManager.processFrontMatter(app.vault.getFileByPath('${path('SampleA/Sample spend')}'), fm => { fm.type = 'note' })
      await until(p.count, 1)
      await until(() => p.summary('Expenses'), '0.00')
      await until(() => store.balanceIndex.value.getBalanceAtDate('${path('SampleA/Sample wallet')}', date), 100)
      return JSON.stringify({ count: p.count(), balance: store.balanceIndex.value.getBalanceAtDate('${path('SampleA/Sample wallet')}', date), loaded: tx.loaded })
    `)
      expect(result).toEqual({ count: 1, balance: 100, loaded: false })
    })

    it('removes a retyped account from the live accounts list', async () => {
      const removed = await probe<boolean>(`
      await app.fileManager.processFrontMatter(app.vault.getFileByPath('${path('SampleB/Sample wallet')}'), fm => { fm.type = 'note' })
      await until(() => store.accountsList.value.accounts.has('${path('SampleB/Sample wallet')}'), false)
      return JSON.stringify(true)
    `)
      expect(removed).toBe(true)
    })
  }
)
