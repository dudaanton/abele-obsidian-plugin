import { expect, it, vi } from 'vitest'
import { SYNC_PRELUDE, SyncDriver } from '../e2e/helpers/syncDriver'
vi.mock('../e2e/helpers/syncVault', () => ({ waitFor: vi.fn() }))

it('unfolds a history version before pressing its Restore action', async () => {
  const box = document.createElement('div')
  box.className = 'abele-version-history'
  const row = document.createElement('div')
  row.className = 'abele-version-history__row'
  row.dataset.version = '1'
  box.append(row)
  document.body.append(box)
  const restored = vi.fn()
  row.onclick = () => {
    row.classList.add('is-active')
    const button = document.createElement('button')
    button.textContent = 'Restore'
    button.onclick = (event) => {
      event.stopPropagation()
      const confirm = document.createElement('div')
      confirm.className = 'modal'
      confirm.append(
        document
          .createRange()
          .createContextualFragment(
            '<p class="abele-confirm__message">Undo changes</p><div class="abele-modal__footer"><button>Restore</button></div>'
          )
      )
      confirm.querySelector('button')!.onclick = restored
      document.body.append(confirm)
    }
    row.append(button)
  }
  const app = {
    plugins: { plugins: { abele: { tokenEngines: { ui: {} } } } },
    setting: { activeTab: { containerEl: document.body } },
  }
  const driver = new SyncDriver(() => ({}) as never)
  const run = vi.spyOn(driver, 'run').mockReturnValue(true)
  await driver.restore('.abele-version-history', '#1')
  try {
    await new Function(
      'app',
      'document',
      `return (async()=>{${SYNC_PRELUDE};${run.mock.calls[0][0]}})()`
    )(app, document)
    expect(restored).toHaveBeenCalledOnce()
  } finally {
    document.querySelectorAll('.modal,.abele-version-history').forEach((one) => one.remove())
  }
}, 25000)

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
      fresh.textContent = 'Reading what has been deleted…'
      document.body.append(fresh)
      setTimeout(() => {
        fresh.textContent = 'Fresh trash'
      }, 250)
    })
    const root = document.createElement('div')
    root.append(
      document
        .createRange()
        .createContextualFragment(
          '<section class="token-sync-settings"><div class="abele-sync-row"><button class="abele-obsidian-icon"><svg class="lucide-more-horizontal"></svg></button></div></section>'
        )
    )
    document.body.append(root)
    root.querySelector('button')!.onclick = () => {
      const menu = document.createElement('div')
      menu.className = 'menu'
      menu.append(
        document
          .createRange()
          .createContextualFragment(
            '<div class="menu-item"><svg class="lucide-trash-2"></svg></div>'
          )
      )
      menu.querySelector<HTMLElement>('.menu-item')!.onclick = () => {
        command()
        menu.remove()
      }
      document.body.append(menu)
    }
    const app = {
      plugins: {
        plugins: { abele: { tokenEngines: { ui: { rows: { value: [{ id: 'sample' }] } } } } },
      },
      setting: {
        close: vi.fn(),
        open: vi.fn(),
        openTabById: vi.fn(),
        activeTab: { containerEl: root },
      },
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
      root.remove()
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
