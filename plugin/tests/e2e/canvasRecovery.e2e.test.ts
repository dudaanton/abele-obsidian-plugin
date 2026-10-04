import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { screenshot } from './helpers/phone'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample canvas recovery'
const SHOTS = shotDir('canvas-recovery')
const mobile = process.env.CANVAS_RECOVERY_MOBILE === '1'
const PRELUDE = `
  const dir = ${JSON.stringify(DIR)}, path = dir + '/sample.canvas'
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const frames = () => Promise.race([
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))),
    wait(3000).then(() => { throw new Error('Canvas frame did not advance') }),
  ])
  const scope = new window.__abeleTest.ScopeResolver(); scope.setFullVaultAccess(true)
  const ctx = { scope, interactive: true, agentId: 'sample-agent' }
  const tools = Object.fromEntries(window.__abeleTest.createAgentTools().map(tool => [tool.name, tool]))
  const read = async () => JSON.parse((await tools.canvas_read.execute('sample-read', { path, detail: 'full' }, undefined, ctx)).content[0].text)
  const view = target => app.workspace.getLeavesOfType('abele-canvas').map(leaf => leaf.view).find(candidate => candidate.file?.path === (target ?? path))
  const fail = async text => {
    const snapshot = await read(), original = app.vault.process
    app.vault.process = async function(file, transform) {
      if (file.path === path) { app.vault.process = original; throw new Error('Sample persistence unavailable') }
      return original.call(this, file, transform)
    }
    try {
      await tools.canvas_edit.execute('sample-failed', { path, revision: snapshot.revision, ops: [{ op: 'update', id: 'sample', patch: { text } }] }, undefined, ctx)
      throw new Error('Expected a write failure')
    } catch (error) { if (!String(error).includes('Sample persistence unavailable')) throw error }
    finally { app.vault.process = original }
    return read()
  }
`
const run = <T>(body: string): T => evalAsync<T>(`(async () => { ${PRELUDE} ${body} })()`, 120_000)
const shoot = (name: string) => {
  if (onPhone()) screenshot(`${SHOTS}/${name}.png`)
  else
    run(
      `await frames(); const image = await require('@electron/remote').getCurrentWebContents().capturePage(); require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/' + ${JSON.stringify(name)} + '.png', image.toPNG()); return true`
    )
}

describe.skipIf(!available)('supported canvas recovery and leaf repair', () => {
  let size: number[] | null = null
  beforeAll(async () => {
    if (mobile && !onPhone()) {
      size = evalJson<number[]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)
      evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
      await reloadApp('app.emulateMobile(true)')
    }
    run(`
      if (app.vault.getAbstractFileByPath(dir)) throw new Error('Synthetic recovery folder already exists')
      window.__canvasRecoveryLayout = app.workspace.getLayout()
      await app.vault.createFolder(dir); window.__canvasRecoveryOwned = true
      await tools.canvas_create.execute('sample-create', { path, from: { graph: { nodes: [{ id: 'sample', kind: 'text', label: 'Original sample', x: 0, y: 0 }], edges: [] } } }, undefined, ctx)
      await app.workspace.getLeaf('tab').setViewState({ type: 'abele-canvas', state: { file: path }, active: true })
      for (let i = 0; i < 40 && !view()?.documentLease; i++) await wait(50)
      return true
    `)
  }, 120_000)
  afterAll(async () => {
    run(`
      for (const leaf of app.workspace.getLeavesOfType('abele-canvas')) if (leaf.view.file?.path.startsWith(dir + '/')) leaf.view.documentLease?.document.discardDraft()
      const leaves = []; app.workspace.iterateAllLeaves(leaf => { if (leaf.view.file?.path.startsWith(dir + '/')) leaves.push(leaf) }); leaves.forEach(leaf => leaf.detach())
      if (window.__canvasRecoveryOwned) { const folder = app.vault.getAbstractFileByPath(dir); if (folder) await app.vault.delete(folder, true) }
      if (window.__canvasRecoveryLayout) await app.workspace.changeLayout(window.__canvasRecoveryLayout)
      delete window.__canvasRecoveryLayout; delete window.__canvasRecoveryOwned
      return true
    `)
    if (size) {
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`
      )
      await reloadApp('app.emulateMobile(false)')
    }
  }, 120_000)

  it('retries a failed proposal through the original production tool and paints the committed result', () => {
    const result = run<{ text: string; dirty: boolean; undo: number; dom: string }>(`
      const pending = await fail('Recovered production sample')
      await tools.canvas_edit.execute('sample-retry', { path, revision: pending.revision, recovery: 'retry', proposal: pending.state.recovery.proposal }, undefined, ctx)
      await frames(); await wait(100); await frames()
      const current = view(), document = current.documentLease.document
      return { text: JSON.parse(await app.vault.read(current.file)).nodes[0].text, dirty: document.session.dirty, undo: document.session.history.undo, dom: current.contentEl.querySelector('[data-node-id="sample"]')?.textContent ?? '' }
    `)
    expect(result).toMatchObject({ text: 'Recovered production sample', dirty: false, undo: 1 })
    expect(result.dom).toContain('Recovered production sample')
    shoot('tool-recovered')
  })

  it('offers explicit local recovery in the standard menu and discards without changing storage', () => {
    const menu = run<{ titles: string[]; visible: boolean }>(`
      await fail('Discard this failed proposal')
      const current = view(), action = current.containerEl.querySelector('[aria-label="Recover failed canvas change"]')
      if (!action) throw new Error('Recovery action not registered')
      const rect = action.getBoundingClientRect()
      action.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.bottom }))
      for (let i = 0; i < 40 && ![...document.querySelectorAll('.menu-item-title')].some(item => item.textContent === 'Discard failed change'); i++) await wait(50)
      await wait(250); await frames()
      return { titles: [...document.querySelectorAll('.menu-item-title')].map(item => item.textContent), visible: rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight }
    `)
    expect(menu.visible).toBe(true)
    expect(menu.titles).toEqual(
      expect.arrayContaining([
        'Retry failed change',
        'Reapply failed change to current diagram',
        'Discard failed change',
      ])
    )
    shoot('recovery-menu')
    const result = run<{ same: boolean; dirty: boolean; text: string }>(`
      const file = app.vault.getAbstractFileByPath(path), before = await app.vault.read(file)
      const item = [...document.querySelectorAll('.menu-item-title')].find(item => item.textContent === 'Discard failed change')
      item.closest('.menu-item').click()
      for (let i = 0; i < 40 && view().documentLease.document.session.dirty; i++) await wait(50)
      await frames()
      return { same: before === await app.vault.read(file), dirty: view().documentLease.document.session.dirty, text: view().viewer.graph.nodes[0].text }
    `)
    expect(result).toEqual({ same: true, dirty: false, text: 'Recovered production sample' })
  })

  it('does not resurrect an old approval revision after the last clean leaf closes and reopens', () => {
    const result = run<{ different: boolean; refused: boolean; same: boolean }>(`
      const approved = await read(), current = view(), file = current.file, before = await app.vault.read(file)
      current.documentLease.document.beginDraft(); current.documentLease.document.discardDraft()
      current.leaf.detach(); await wait(100)
      await app.workspace.getLeaf('tab').setViewState({ type: 'abele-canvas', state: { file: path }, active: true })
      for (let i = 0; i < 40 && !view()?.documentLease; i++) await wait(50)
      const reopened = await read(); let refused = false
      try { await tools.canvas_edit.execute('sample-stale', { path, revision: approved.revision, ops: [{ op: 'update', id: 'sample', patch: { text: 'Stale approval' } }] }, undefined, ctx) } catch (error) { refused = /changed|reread/i.test(String(error)) }
      return { different: approved.revision !== reopened.revision, refused, same: before === await app.vault.read(file) }
    `)
    expect(result).toEqual({ different: true, refused: true, same: true })
  })

  it('opens a canonical imported filename, retains identity on rename, and repairs an invalid leaf in place', () => {
    const result = run<{
      imported: boolean
      renamed: boolean
      repaired: boolean
      unchanged: boolean
      dom: string
    }>(`
      const special = dir + '/sample#board[old]^1.canvas'
      const raw = JSON.stringify({ nodes: [{ id: 'sample-special', type: 'text', text: 'Imported canonical sample', x: 0, y: 0, width: 260, height: 160 }], edges: [] })
      const file = await app.vault.create(special, raw), leaf = app.workspace.getLeaf('tab')
      await leaf.setViewState({ type: 'abele-canvas', state: { file: special }, active: true })
      for (let i = 0; i < 40 && !view(special)?.documentLease; i++) await wait(50)
      const originalDocument = view(special)?.documentLease?.document, imported = !!originalDocument
      const renamedPath = dir + '/sample#renamed[board]^2.canvas'
      await app.fileManager.renameFile(file, renamedPath); await wait(150)
      const renamed = leaf.view.documentLease?.document === originalDocument
      const invalidPath = dir + '/sample-repair.canvas', invalid = await app.vault.create(invalidPath, '{malformed'), repairLeaf = app.workspace.getLeaf('tab')
      await repairLeaf.setViewState({ type: 'abele-canvas', state: { file: invalidPath }, active: true })
      const repairedRaw = JSON.stringify({ nodes: [{ id: 'sample-repaired', type: 'text', text: 'Repaired in the same leaf', x: 0, y: 0, width: 260, height: 160 }], edges: [] })
      await app.vault.modify(invalid, repairedRaw)
      for (let i = 0; i < 40 && !repairLeaf.view.documentLease; i++) await wait(50)
      await app.workspace.revealLeaf(repairLeaf); await frames(); await wait(100); await frames()
      return { imported, renamed, repaired: repairLeaf.view.viewer?.graph.nodes[0]?.text === 'Repaired in the same leaf', unchanged: await app.vault.read(invalid) === repairedRaw && await app.vault.read(file) === raw, dom: repairLeaf.view.contentEl.querySelector('[data-node-id="sample-repaired"]')?.textContent ?? '' }
    `)
    expect(result).toMatchObject({ imported: true, renamed: true, repaired: true, unchanged: true })
    expect(result.dom).toContain('Repaired in the same leaf')
    shoot('repaired-leaf')
  })
})
