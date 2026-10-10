import { expect, it, vi } from 'vitest'
import { SYNC_PRELUDE } from '../e2e/helpers/syncDriver'
vi.mock('../e2e/helpers/syncVault', () => ({ waitFor: vi.fn() }))

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
