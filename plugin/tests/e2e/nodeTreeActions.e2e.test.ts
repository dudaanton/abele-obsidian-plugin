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
    client.channel = { channel: { welcome: { methods: ['repository.v1.write', 'repository.v1.file.mkdir', 'repository.v1.file.directory', 'repository.v1.file.move', 'repository.v1.file.remove'] } } }
    client.nodePath.fileDirectory = async () => ({ content_id: 'b'.repeat(64), entries: [{ path: '', kind: 'directory', content_id: null }, { path: 'nested', kind: 'directory', content_id: null }, { path: 'nested/sample-long-file-name.ts', kind: 'file', content_id: 'a'.repeat(64) }, ...Array.from({length: 30}, (_, i) => ({ path: 'nested/sample-long-file-name-' + i + '.ts', kind: 'file', content_id: 'a'.repeat(64) }))] })
    client.repository.editingStatus = async () => ({ enabled: true })
    const worktrees = client.repository.worktrees
    client.repository.worktrees = async params => {
      if (!params.include_identity) throw Error('New node worktree identities were not requested')
      const page = await worktrees(params)
      return { ...page, entries: page.entries.map(row => ({ ...row, identity: { canonical_path: '/sample/worktrees/' + row.worktree_id, fingerprint: 'a'.repeat(64) } })) }
    }
    await state.model.refresh()
    if (state.model.current.value.location?.path !== '/sample/worktrees/' + state.model.current.value.id) throw Error('Canonical worktree location was discarded')
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
      if ([...modal.querySelectorAll('button')].some(button => button.textContent.includes("…") || button.textContent.includes("..."))) throw Error('Action button contains an ellipsis')
      const input = modal.querySelector('input')
      if (input) {
        input.value = 'sample-folder/a-long-file-name-for-the-selected-operation.ts'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await wait(100)
      }
      if (name === 'Rename…') {
        [...modal.querySelectorAll('button')].find(button => button.textContent.trim() === 'Rename').click()
        await until(() => modal.textContent.includes('Enter a file name without folders.'))
      }
      await until(() => modal.closest('.modal-container').getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'))
      const box = modal.getBoundingClientRect()
      fits = fits && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
      if (!fits) throw Error('Dialog outside viewport: ' + device + '-' + suffix + ' ' + JSON.stringify(box.toJSON()))
      require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/' + device + '-' + suffix + '.png', (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())
      const cancel = [...modal.querySelectorAll('button')].find(button => button.textContent.trim() === 'Cancel')
      if (!cancel) throw Error('File action has no Cancel')
      cancel.click()
      await until(() => !document.querySelector('.modal.abele-modal'))
    }
    for (const [name, suffix] of [['Rename…', 'folder-rename'], ['Move…', 'folder-move'], ['Delete…', 'folder-delete']]) {
      await app.workspace.revealLeaf(state.leaf)
      app.workspace.leftSplit.expand()
      await wait(100)
      const row = await until(() => panel.querySelector('[data-path="src"]'))
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 200 }))
      const item = await until(() => [...document.querySelectorAll('.menu-item')].find(el => el.textContent.trim() === name))
      item.click()
      let modal = await until(() => document.querySelector('.modal.abele-modal'))
      if (name !== 'Delete…') {
        const input = modal.querySelector('input')
        input.value = 'renamed-folder'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await wait(100)
        const label = name === 'Rename…' ? 'Rename' : 'Move'
        ;[...modal.querySelectorAll('button')].find(button => button.textContent.trim() === label).click()
        await until(() => document.querySelector('.modal.abele-modal')?.textContent.includes('nested/sample-long-file-name.ts'))
        modal = document.querySelector('.modal.abele-modal')
      }
      await until(() => modal.textContent.includes('nested/sample-long-file-name.ts'))
      await wait(200)
      await until(() => modal.closest('.modal-container').getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'))
      const box = modal.getBoundingClientRect()
      fits = fits && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
      if (!fits) throw Error('Dialog outside viewport: ' + device + '-' + suffix + ' ' + JSON.stringify(box.toJSON()))
      if ([...modal.querySelectorAll('button')].some(button => button.textContent.includes("…") || button.textContent.includes("..."))) throw Error('Folder action button contains an ellipsis')
      require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/' + device + '-' + suffix + '.png', (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())
      ;[...modal.querySelectorAll('button')].find(button => button.textContent.trim() === 'Cancel').click()
      await until(() => !document.querySelector('.modal.abele-modal'))
    }
    const view = state.leaf.view
    state.nodes.nodes.value = []
    view.registrationId.value = ''
    view.local.value = { nodeName: 'Sample local node', nodeId: 'sample-local', endpoint: 'ws://127.0.0.1:1234/channel', nodeVersion: '0.4.36' }
    view.localPhase.value = 'found'
    await until(() => panel.textContent.includes('AbeleNode 0.4.36 is running on this computer'))
    require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/' + device + '-local-node.png', (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())
    return fits
  } finally { await nodePanel.close() }
})()`)

it('opens file operations in the shared dialogs on desktop', () => {
  expect(probe('desktop')).toBe(true)
})
it('keeps file operation dialogs within the phone viewport', async () => {
  expect(await withEmulatedPhone(async () => probe('phone'))).toBe(true)
})
