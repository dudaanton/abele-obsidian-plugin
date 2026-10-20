import { expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { targets } from './helpers/target'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { NODE_PANEL_FIXTURE } from './helpers/nodePanelFixture'

targets('desktop')
const SHOTS = shotDir('abele-node-tree-actions')
const probe = (device: string) =>
  evalAsync<boolean>(`(async () => {
  const device = ${JSON.stringify(device)}
  ${NODE_PANEL_FIXTURE}
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async f => { for (let i = 0; i < 100; i++) { const value = f(); if (value) return value; await wait(50) } throw Error('File action did not open') }
  try {
    const panel = await nodePanel.open('feature')
    await nodePanel.mode('Files')
    const state = window.__abeleNodePanelFixture
    const client = state.nodes.connection(state.registration.id).client
    client.channel = { channel: { welcome: { methods: ['repository.v1.write', 'repository.v1.file.mkdir', 'repository.v1.file.move', 'repository.v1.file.remove'] } } }
    client.repository.editingStatus = async () => ({ enabled: true })
    let fits = true
    for (const [name, suffix] of [['New file…', 'new-file'], ['New folder…', 'new-folder'], ['Rename…', 'rename'], ['Move…', 'move'], ['Delete…', 'delete']]) {
      await app.workspace.revealLeaf(state.leaf)
      app.workspace.leftSplit.expand()
      await wait(200)
      const row = await until(() => panel.querySelector('[data-path="README.md"]'))
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 200 }))
      const item = await until(() => [...document.querySelectorAll('.menu-item')].find(el => el.textContent.trim() === name))
      item.click()
      const modal = await until(() => document.querySelector('.modal.abele-modal'))
      await wait(200)
      const input = modal.querySelector('input')
      if (input) {
        input.value = 'sample-folder/a-long-file-name-for-the-selected-operation.ts'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await wait(100)
      }
      if (name === 'Rename…') {
        [...modal.querySelectorAll('button')].find(button => button.textContent.trim() === name).click()
        await until(() => modal.textContent.includes('Enter a file name without folders.'))
      }
      const box = modal.getBoundingClientRect()
      fits = fits && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
      require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/' + device + '-' + suffix + '.png', (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())
      const cancel = [...modal.querySelectorAll('button')].find(button => button.textContent.trim() === 'Cancel')
      if (!cancel) throw Error('File action has no Cancel')
      cancel.click()
      await until(() => !document.querySelector('.modal.abele-modal'))
    }
    return fits
  } finally { await nodePanel.close() }
})()`)

it('opens file operations in the shared dialogs on desktop', () => {
  expect(probe('desktop')).toBe(true)
})
it('keeps file operation dialogs within the phone viewport', async () => {
  expect(await withEmulatedPhone(async () => probe('phone'))).toBe(true)
})
