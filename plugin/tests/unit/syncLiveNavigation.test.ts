import { expect, it, vi } from 'vitest'
import { SYNC_PRELUDE, SyncDriver } from '../e2e/helpers/syncDriver'
vi.mock('../e2e/helpers/syncVault', () => ({ waitFor: vi.fn() }))

it.each(['modal-close-button', 'modal-header-button'])(
  'reopens trash through the native %s instead of inspecting an old list',
  async (buttonClass) => {
    const old = document.createElement('div')
    old.className = 'modal'
    const close = document.createElement('button'),
      list = document.createElement('div')
    close.className = buttonClass
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    icon.classList.add('lucide-x')
    close.append(icon)
    list.className = 'abele-deleted-files'
    list.textContent = 'Old empty trash'
    old.append(close, list)
    document.body.append(old)
    old.querySelector('button')!.addEventListener('click', () => old.remove())
    const command = vi.fn(() => {
      if (document.querySelector('.abele-deleted-files')) return
      const fresh = document.createElement('div')
      fresh.className = 'abele-deleted-files'
      fresh.textContent = 'Fresh trash'
      document.body.append(fresh)
    })
    const app = {
      plugins: { plugins: { abele: { tokenEngines: { ui: {} } } } },
      setting: { close: vi.fn() },
      commands: { executeCommandById: command },
    }
    const driver = new SyncDriver(() => ({}) as never),
      run = vi.spyOn(driver, 'run').mockReturnValue(true)
    await driver.trash()
    try {
      await new Function(
        'app',
        'document',
        `return (async()=>{${SYNC_PRELUDE};${run.mock.calls[0][0]}})()`
      )(app, document)
      expect(document.querySelector('.abele-deleted-files')?.textContent).toBe('Fresh trash')
    } finally {
      document.querySelectorAll('.modal,.abele-deleted-files').forEach((one) => one.remove())
    }
  }
)

it('reuses an already open phone Sync page whose tab menu is hidden', async () => {
  const root = document.createElement('div')
  const page = document.createElement('section')
  page.className = 'token-sync-settings'
  root.append(page)
  const app = {
    plugins: { plugins: { abele: { tokenEngines: { ui: {} } } } },
    setting: { open: vi.fn(), openTabById: vi.fn(), activeTab: { containerEl: root } },
  }
  const run = new Function(
    'app',
    'document',
    `return (async()=>{${SYNC_PRELUDE};return await openSyncTab()})()`
  )
  expect(await run(app, document)).toBe(root)
})
it('finds settings dialogs in either Obsidian owner window', async () => {
  const other = document.implementation.createHTMLDocument()
  const held = other.createElement('div')
  held.className = 'abele-held-deletes'
  other.body.append(held)
  const app = {
    plugins: { plugins: { abele: { tokenEngines: { ui: {} } } } },
    setting: { activeTab: { containerEl: other.body } },
  }
  const run = new Function(
    'app',
    'document',
    `return (async()=>{${SYNC_PRELUDE};return inWindows('.abele-held-deletes')})()`
  )
  expect(await run(app, document)).toBe(other.body.firstChild)
})
