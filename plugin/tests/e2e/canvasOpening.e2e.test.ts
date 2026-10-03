import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { screenshot } from './helpers/phone'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const mobile = process.env.CANVAS_OPENING_MOBILE === '1'
const DIR = 'Sample canvas opening'
const SHOTS = shotDir('canvas-opening')
const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const dir = ${JSON.stringify(DIR)}
  ${body}
})()`,
    120_000
  )
const shoot = (name: string) => {
  const path = `${SHOTS}/${name}.png`
  if (onPhone()) screenshot(path)
  else
    run(
      `const img = await require('@electron/remote').getCurrentWebContents().capturePage(); require('fs').writeFileSync(${JSON.stringify(path)}, img.toPNG()); return true`
    )
}

describe.skipIf(!available)('new native Canvas opening', () => {
  let size: number[] | null = null
  beforeAll(async () => {
    if (mobile && !onPhone()) {
      size = evalJson<number[]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)
      evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
      await reloadApp('app.emulateMobile(true)')
    }
    run(`
      if (app.vault.getAbstractFileByPath(dir)) throw new Error('Synthetic folder already exists')
      window.__canvasOpeningLayout = app.workspace.getLayout()
      window.__canvasOpeningPreference = window.__abeleTest.AbeleConfig.getInstance().canvasViewer
      window.__canvasOpeningFiles = []
      await app.vault.createFolder(dir)
      window.__canvasOpeningOwned = true
      window.__abeleTest.AbeleConfig.getInstance().canvasViewer = true
      return true
    `)
  }, 120_000)
  afterAll(async () => {
    run(`
      window.__abeleTest.AbeleConfig.getInstance().canvasViewer = false
      const paths = window.__canvasOpeningFiles ?? []
      const leaves = []; app.workspace.iterateAllLeaves(l => { if (paths.includes(l.view.file?.path) || l.view.file?.path.startsWith(dir + '/')) leaves.push(l) })
      leaves.forEach(l => l.detach())
      for (const path of paths) { const file = app.vault.getAbstractFileByPath(path); if (file) await app.vault.delete(file, true) }
      if (window.__canvasOpeningOwned) { const folder = app.vault.getAbstractFileByPath(dir); if (folder) await app.vault.delete(folder, true) }
      if (window.__canvasOpeningLayout) await app.workspace.changeLayout(window.__canvasOpeningLayout)
      if (window.__canvasOpeningPreference !== undefined) window.__abeleTest.AbeleConfig.getInstance().canvasViewer = window.__canvasOpeningPreference
      delete window.__canvasOpeningFiles; delete window.__canvasOpeningOwned; delete window.__canvasOpeningLayout; delete window.__canvasOpeningPreference
      return true
    `)
    if (size) {
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`
      )
      await reloadApp('app.emulateMobile(false)')
    }
  }, 120_000)

  it('opens the native new-file command in the default viewer without initializing or overwriting bytes', () => {
    const result = run<{ type: string; bytes: string; nodes: number; error: boolean }>(`
      const leaf = app.workspace.getLeaf('tab'); await app.workspace.revealLeaf(leaf)
      const before = new Set(app.vault.getFiles().map(f => f.path))
      if (!app.commands.executeCommandById('canvas:new-file')) throw new Error('Native Canvas command unavailable')
      await wait(600)
      const file = app.vault.getFiles().find(f => f.extension === 'canvas' && !before.has(f.path))
      if (!file) throw new Error('Native command did not create a Canvas')
      window.__canvasOpeningFiles.push(file.path)
      const v = app.workspace.activeLeaf.view
      return { type: v.getViewType(), bytes: await app.vault.read(file), nodes: v.viewer?.graph.nodes.length ?? -1,
        error: [...document.querySelectorAll('.notice')].some(n => /Could not open diagram/.test(n.textContent)) }
    `)
    expect(result).toEqual({ type: 'abele-canvas', bytes: '', nodes: 0, error: false })
    shoot('native-new-file')
  }, 120_000)

  it.each(['{}', '{"nodes":[],"edges":[]}'])(
    'opens a valid empty native file %s and preserves its bytes',
    (bytes) => {
      const result = run<{ type: string; bytes: string; nodes: number; status: string }>(`
      const path = dir + '/sample-empty-' + window.__canvasOpeningFiles.length + '.canvas'
      const file = await app.vault.create(path, ${JSON.stringify(bytes)}); window.__canvasOpeningFiles.push(path)
      const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(file); await app.workspace.revealLeaf(leaf); await wait(600)
      return { type: leaf.view.getViewType(), bytes: await app.vault.read(file), nodes: leaf.view.viewer?.graph.nodes.length ?? -1, status: leaf.view.viewer?.status.textContent ?? 'No viewer' }
    `)
      expect(result.type).toBe('abele-canvas')
      expect(result.bytes).toBe(bytes)
      expect(result.nodes).toBe(0)
      expect(result.status).not.toMatch(/could not be read/i)
      shoot('valid-empty-' + (bytes === '{}' ? 'object' : 'arrays'))
    },
    120_000
  )

  it('waits for pending native content and retries after the delayed native save', () => {
    const result = run<{ pending: string; saved: string; same: boolean; text: string }>(`
      window.__abeleTest.AbeleConfig.getInstance().canvasViewer = false
      const file = await app.vault.create(dir + '/sample-pending.canvas', '')
      window.__canvasOpeningFiles.push(file.path)
      const leaf = app.workspace.getLeaf('tab'); await leaf.openFile(file); await app.workspace.revealLeaf(leaf)
      const native = leaf.view
      native.canvas.setData({ nodes: [{ id: 'sample', type: 'text', text: 'Delayed sample content', x: 0, y: 0, width: 200, height: 100 }], edges: [] })
      window.__abeleTest.AbeleConfig.getInstance().canvasViewer = true
      app.workspace.trigger('layout-change'); await wait(200)
      const pending = leaf.view.getViewType()
      if (pending !== 'canvas') throw new Error('Pending native content was discarded')
      let saved = null
      const event = app.vault.on('modify', changed => {
        if (changed === file && saved === null) void app.vault.read(file).then(bytes => { saved = bytes })
      })
      try {
        native.canvas.requestSave()
        for (let i = 0; i < 60 && saved === null; i++) await wait(100)
        if (saved === null) throw new Error('Native initial save did not finish')
        await wait(600)
        return { pending, saved: leaf.view.getViewType(), same: saved === await app.vault.read(file), text: leaf.view.viewer?.graph.nodes[0]?.text ?? '' }
      } finally { app.vault.offref(event) }
    `)
    expect(result).toEqual({
      pending: 'canvas',
      saved: 'abele-canvas',
      same: true,
      text: 'Delayed sample content',
    })
    shoot('delayed-native-save')
  }, 120_000)

  it.each([
    { nodes: [], edges: [] },
    {
      nodes: [
        { id: 'sample', type: 'text', text: 'Sample content', x: 0, y: 0, width: 200, height: 100 },
      ],
      edges: [],
    },
  ])(
    'rejects a JSON-string-wrapped graph %# in both native adoption and the viewer',
    (graph) => {
      const result = run<{
        native: string
        viewer: string
        status: string
        unchanged: boolean
        other: string
      }>(`
      const graph = ${JSON.stringify(graph)}, serialized = JSON.stringify(graph), encoded = JSON.stringify(serialized)
      const path = dir + '/sample-encoded-' + window.__canvasOpeningFiles.length + '.canvas'
      window.__abeleTest.AbeleConfig.getInstance().canvasViewer = false
      const file = await app.vault.create(path, serialized); window.__canvasOpeningFiles.push(path)
      const nativeLeaf = app.workspace.getLeaf('tab')
      await nativeLeaf.setViewState({ type: 'canvas', state: { file: path }, active: true })
      await app.vault.modify(file, encoded)
      window.__abeleTest.AbeleConfig.getInstance().canvasViewer = true
      app.workspace.trigger('layout-change'); await wait(300)
      const native = nativeLeaf.view.getViewType()
      const viewerLeaf = app.workspace.getLeaf('tab')
      await viewerLeaf.setViewState({ type: 'abele-canvas', state: { file: path }, active: true })
      const otherPath = dir + '/sample-valid-' + window.__canvasOpeningFiles.length + '.canvas'
      const otherFile = await app.vault.create(otherPath, '{"nodes":[],"edges":[]}'); window.__canvasOpeningFiles.push(otherPath)
      const otherLeaf = app.workspace.getLeaf('tab')
      await otherLeaf.setViewState({ type: 'canvas', state: { file: otherPath }, active: true }); await wait(600)
      await app.workspace.revealLeaf(viewerLeaf); await wait(100)
      return { native, viewer: viewerLeaf.view.getViewType(), status: viewerLeaf.view.viewer?.status.textContent ?? '',
        unchanged: encoded === await app.vault.read(file), other: otherLeaf.view.getViewType() }
    `)
      expect(result.native).toBe('canvas')
      expect(result.viewer).toBe('abele-canvas')
      expect(result.status).toMatch(/could not be read/i)
      expect(result.unchanged).toBe(true)
      expect(result.other).toBe('abele-canvas')
      shoot('encoded-' + (graph.nodes.length ? 'populated' : 'empty'))
    },
    120_000
  )

  it('keeps unsaved native edits and malformed nonempty bytes while adopting another leaf', () => {
    const result = run<{
      pending: string
      edit: string
      unchanged: boolean
      malformed: string
      broken: string
      other: string
    }>(`
      window.__abeleTest.AbeleConfig.getInstance().canvasViewer = false
      const graph = { nodes: [{ id: 'sample', type: 'text', text: 'Stored sample content', x: 0, y: 0, width: 200, height: 100 }], edges: [] }
      const bytes = JSON.stringify(graph)
      const file = await app.vault.create(dir + '/sample-edit.canvas', bytes)
      const broken = await app.vault.create(dir + '/sample-broken.canvas', bytes)
      window.__canvasOpeningFiles.push(file.path, broken.path)
      const editedLeaf = app.workspace.getLeaf('tab'); await editedLeaf.setViewState({ type: 'canvas', state: { file: file.path }, active: true })
      const brokenLeaf = app.workspace.getLeaf('tab'); await brokenLeaf.setViewState({ type: 'canvas', state: { file: broken.path }, active: true })
      await app.vault.modify(broken, '{"nodes":[]')
      graph.nodes[0].text = 'Unsaved sample content'
      editedLeaf.view.canvas.setData(graph)
      const other = await app.vault.create(dir + '/sample-other.canvas', '{"nodes":[],"edges":[]}')
      window.__canvasOpeningFiles.push(other.path)
      const otherLeaf = app.workspace.getLeaf('tab'); await otherLeaf.setViewState({ type: 'canvas', state: { file: other.path }, active: true })
      window.__abeleTest.AbeleConfig.getInstance().canvasViewer = true
      app.workspace.trigger('layout-change'); await wait(600)
      await app.workspace.revealLeaf(editedLeaf)
      return { pending: editedLeaf.view.getViewType(), edit: editedLeaf.view.canvas.getData().nodes[0].text,
        unchanged: bytes === await app.vault.read(file), malformed: await app.vault.read(broken), broken: brokenLeaf.view.getViewType(), other: otherLeaf.view.getViewType() }
    `)
    expect(result).toEqual({
      pending: 'canvas',
      edit: 'Unsaved sample content',
      unchanged: true,
      malformed: '{"nodes":[]',
      broken: 'canvas',
      other: 'abele-canvas',
    })
    shoot('unsaved-native-edit')
  }, 120_000)
})
