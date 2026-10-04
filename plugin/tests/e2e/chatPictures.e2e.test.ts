import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { shotDir } from './helpers/shots'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'

targets('desktop', 'phone')
const HEIC = readFileSync(
  new URL('../fixtures/images/sample-gradient.heic', import.meta.url)
).toString('base64')
const DIR = 'Sample image chat probe'
const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('chat-pictures')
const PANE_PRELUDE = `
  const ownedPanes = []
  const previousLeaf = app.workspace.activeLeaf
  const makePane = async () => {
    const leaf = app.workspace.getLeaf('split')
    ownedPanes.push(leaf)
    await leaf.setViewState({ type: 'abele-ai-sidebar-view', active: true })
    await until(() => leaf.view.containerEl.querySelector('.abele-chat-input')?.__vueParentComponent?.exposed)
    return leaf
  }
  const paneHost = leaf => leaf.view.containerEl.isConnected ? leaf.view.containerEl.querySelector('.abele-chat-input') : null
  const paneInput = leaf => paneHost(leaf)?.__vueParentComponent?.exposed
  const capture = async name => {
    const path = ${JSON.stringify(SHOTS + '/')} + name + '.png'
    if (${onPhone()}) return window.__e2eHost.shot(path)
    const image = await require('@electron/remote').getCurrentWebContents().capturePage()
    require('fs').writeFileSync(path, image.toPNG())
    return path
  }
  const evidence = session => ({
    sessionId: tab,
    logicalPaths: session?.draft.value.attachments.map(file => file.path),
    logicalText: session?.draft.value.text,
    panes: ownedPanes.map(leaf => ({ id: leaf.id, connected: leaf.view.containerEl.isConnected,
      owner: paneInput(leaf)?.isDraftFor({ sessionId: tab, version: session?.conversationVersion.value }),
      sharesDraft: !!paneInput(leaf) && paneInput(leaf).takeDraft() === session?.draft.value,
      thumbnails: [...(paneHost(leaf)?.querySelectorAll('.abele-chat-input__attachments img') || [])].map(img => img.alt) })),
    globalImages: document.querySelectorAll('.abele-chat-input__attachments img').length,
  })
`

describe.skipIf(!available)('chat pictures and image import in the running browser', () => {
  beforeAll(() => {
    evalRaw(`(async () => {
      if (!app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})) await app.vault.createFolder(${JSON.stringify(DIR)})
      return 'ok'
    })()`)
  })
  afterAll(() => {
    evalRaw(`(async () => {
      document.querySelector('.abele-gallery-viewer__close')?.click()
      const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (dir) await app.vault.delete(dir, true)
      return 'ok'
    })()`)
  })

  it('converts HEIC natively on the phone and preserves it as a file on desktop', async () => {
    const result = JSON.parse(
      await evalLong(
        `(async () => {
      const folder = app.vault.getConfig('attachmentFolderPath')
      try {
        app.vault.setConfig('attachmentFolderPath', ${JSON.stringify(DIR)})
        const bytes = Uint8Array.from(atob(${JSON.stringify(HEIC)}), c => c.charCodeAt(0))
        const made = await window.__abeleTest.importExternalFile(new File([bytes], 'sample-gradient.HEIC', { type: 'image/heic' }))
        const saved = new Uint8Array(await app.vault.readBinary(made))
        if (made.extension.toLowerCase() !== 'png') return {
          name: made.name,
          unchanged: saved.length === bytes.length && saved.every((b, i) => b === bytes[i]),
          notice: [...document.querySelectorAll('.notice')].map(n => n.textContent).join(' '),
        }
        const model = await window.__abeleTest.prepareImageForApi(made.path)
        const url = URL.createObjectURL(new Blob([saved], { type: 'image/png' }))
        try {
          const img = new Image(); img.src = url; await img.decode()
          return { name: made.name, signature: [...saved.slice(0, 8)], width: img.naturalWidth, height: img.naturalHeight, model: model?.slice(0, 22) }
        } finally { URL.revokeObjectURL(url) }
      } catch (e) { return { error: String(e?.stack || e) } }
      finally { app.vault.setConfig('attachmentFolderPath', folder) }
    })()`,
        150_000
      )
    )
    expect(result.error).toBeUndefined()
    if (onPhone()) {
      expect(result.name).toBe('sample-gradient.png')
      expect(result.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      expect([result.width, result.height]).toEqual([48, 32])
      expect(result.model).toBe('data:image/png;base64,')
    } else {
      expect(result.name).toBe('sample-gradient.HEIC')
      expect(result.unchanged).toBe(true)
      expect(result.notice).toMatch(/HEIC.*iPhone\/iPad.*original file/)
    }
  }, 180_000)

  it.each(['sample', 'sample.jpg'])(
    'persists MIME-only HEIC type for %s rather than sending bytes as text or pixels',
    async (name) => {
      const result = JSON.parse(
        await evalLong(
          `(async () => {
      const folder = app.vault.getConfig('attachmentFolderPath')
      try {
        app.vault.setConfig('attachmentFolderPath', ${JSON.stringify(DIR)})
        const bytes = Uint8Array.from(atob(${JSON.stringify(HEIC)}), c => c.charCodeAt(0))
        const file = await window.__abeleTest.importExternalFile(new File([bytes], ${JSON.stringify(name)}, { type: 'image/heic' }))
        const parts = await window.__abeleTest.resolveAttachmentsForApi([file.path])
        return { name: file.name, path: file.path, parts }
      } catch (e) { return { error: String(e?.stack || e) } }
      finally { app.vault.setConfig('attachmentFolderPath', folder) }
    })()`,
          60_000
        )
      )
      expect(result.error).toBeUndefined()
      if (onPhone()) {
        expect(result.name).toBe(name + '.png')
        expect(result.parts).toContainEqual({
          type: 'image_url',
          image_url: { url: 'vault:' + result.path },
        })
      } else {
        expect(result.name).toBe(name + '.heic')
        expect(result.parts).toEqual([
          {
            type: 'text',
            text: '[File attachment: ' + result.path + ' (HEIC/HEIF; not converted)]',
          },
        ])
      }
    },
    90_000
  )

  it.each(['reset', 'drawing', 'run', 'run-text', 'panel'])(
    'preserves conversation ownership and the import barrier across %s',
    async (scenario) => {
      const result = JSON.parse(
        await evalLong(
          `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms))
      const until = async fn => { for (let i = 0; i < 160; i++) { const value = fn(); if (value) return value; await wait(50) } throw new Error('UI did not appear') }
      const chats = window.__abeleTest.ChatService.getInstance()
      const prior = chats.activeTabId.value
      const tab = chats.createTab()
      if (tab === prior) return { error: 'No free temporary chat tab' }
      const runId = 'run:sample-import-probe'
      const originalRead = app.vault.readBinary
      let release
      let held
      let originalSend
      let session
      const observations = []
      ${PANE_PRELUDE}
      let sourcePane, mirrorPane
      try {
        const bytes = Uint8Array.from(atob(${JSON.stringify(HEIC)}), c => c.charCodeAt(0))
        const source = await app.vault.createBinary(${JSON.stringify(DIR)} + '/sample-' + ${JSON.stringify(scenario)} + '.heic', bytes.buffer)
        app.vault.readBinary = async function(file) {
          if (file.path === source.path) await new Promise(r => { release = r })
          return originalRead.call(this, file)
        }
        sourcePane = await makePane()
        mirrorPane = await makePane()
        app.workspace.setActiveLeaf(sourcePane, { focus: false })
        const host = () => paneHost(sourcePane)
        const composer = () => paneInput(sourcePane)
        const input = await until(composer)
        session = chats.getSession(tab)
        originalSend = session.sendMessage
        const sends = []
        session.sendMessage = async (...args) => { sends.push(args) }
        input.addAttachment(source)
        held = input.takeDraft()
        await until(() => release)
        if (${JSON.stringify(scenario)} === 'reset') {
          await session.reset()
          await wait(100)
        } else if (${JSON.stringify(scenario)} === 'drawing') {
          const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16
          const blob = await new Promise(r => canvas.toBlob(r, 'image/png'))
          const original = await app.vault.createBinary(${JSON.stringify(DIR)} + '/sample-return-source.png', await blob.arrayBuffer())
          const drawn = await app.vault.createBinary(${JSON.stringify(DIR)} + '/sample-return-result.png', await blob.arrayBuffer())
          input.addAttachment(original)
          chats.pendingInput.value = { text: '', tabId: tab, replaceAttachment: original.path, attachments: [drawn.path] }
          await wait(100)
        } else if (${JSON.stringify(scenario)} === 'panel') {
          observations.push({ phase: 'before-detach', ...evidence(session) })
          await capture('panel-before-detach')
          sourcePane.detach()
          observations.push({ phase: 'after-detach', ...evidence(session) })
          await capture('panel-mirror-remains')
          await until(() => !host())
          if (!paneHost(mirrorPane)) throw new Error('Detaching the selected pane removed the mirror pane')
          sourcePane = await makePane()
          await until(composer)
          await wait(100)
        } else {
          chats.runTabs.set(runId, { type: 'abele-run', runId: 'sample-import-probe', agentName: 'Sample', task: 'Fabricated read-only run', branches: [], status: 'done', parentChat: '' })
          chats.tabOrder.value = [...chats.tabOrder.value, runId]
          chats.switchTab(runId)
          await until(() => !host())
          if (${JSON.stringify(scenario)} === 'run-text') {
            chats.pendingInput.value = { text: 'Incoming sample passage', tabId: tab }
          }
          chats.switchTab(tab)
          await until(composer)
          await wait(100)
        }
        const probe = window.__abeleTest.composer(sourcePane.view.containerEl)
        probe.focus()
        probe.keyTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', shiftKey: true, bubbles: true, cancelable: true }))
        await wait(50)
        const before = sends.length
        release(); release = null
        await until(() => !held.imports.pending.size)
        const paths = composer().takeDraft().attachments.map(f => f.path)
        const ownership = evidence(session)
        if (${JSON.stringify(scenario)} === 'panel') await capture('panel-remounted')
        const scope = session.scopeResolver.entries.value.map(e => e.path)
        const box = host().getBoundingClientRect()
        const thumbnail = host().querySelector('.abele-chat-input__attachments img')?.getBoundingClientRect()
        if (${JSON.stringify(scenario)} !== 'reset') {
          const ready = window.__abeleTest.composer(sourcePane.view.containerEl)
          ready.focus()
          ready.keyTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', shiftKey: true, bubbles: true, cancelable: true }))
          await wait(50)
        }
        return { before, paths, scope, sends: sends.length, sentText: sends.at(-1)?.[0],
          composerSize: [box.width, box.height], thumbnailSize: thumbnail ? [thumbnail.width, thumbnail.height] : null,
          observations, ownership }
      } catch (e) { return { error: String(e?.stack || e), observations, ownership: evidence(session) } }
      finally {
        if (release) release()
        if (held?.imports) await until(() => !held.imports.pending.size).catch(() => {})
        app.vault.readBinary = originalRead
        if (session && originalSend) session.sendMessage = originalSend
        if (chats.getRun(runId)) await chats.closeTab(runId)
        await chats.closeTab(tab)
        if (prior) chats.switchTab(prior)
        for (const leaf of ownedPanes) if (leaf.view.containerEl.isConnected) leaf.detach()
        if (previousLeaf?.view.containerEl.isConnected) app.workspace.setActiveLeaf(previousLeaf, { focus: false })
      }
    })()`,
          120_000
        )
      )
      console.log('picture import ownership', scenario, JSON.stringify(result))
      writeFileSync(join(SHOTS, scenario + '-ownership.json'), JSON.stringify(result, null, 2))
      expect(result.error).toBeUndefined()
      expect(result.before).toBe(0)
      expect(result.ownership.logicalPaths).toEqual(result.paths)
      for (const pane of result.ownership.panes.filter(
        (pane: { connected: boolean }) => pane.connected
      )) {
        expect(pane.owner).toBe(true)
        expect(pane.sharesDraft).toBe(true)
      }
      if (scenario === 'reset') {
        expect(result.paths).toEqual([])
        expect(result.scope.some((p: string) => p.startsWith(DIR))).toBe(false)
      } else {
        expect(result.paths).toHaveLength(scenario === 'drawing' ? 2 : 1)
        const name = onPhone() ? '.png' : '.heic'
        expect(result.paths.some((p: string) => p.endsWith('sample-' + scenario + name))).toBe(true)
        expect(result.sends).toBe(1)
        if (scenario === 'run-text') expect(result.sentText).toBe('Incoming sample passage')
        if (scenario === 'panel') {
          const [beforeDetach, afterDetach] = result.observations
          expect(beforeDetach.panes.map((pane: { connected: boolean }) => pane.connected)).toEqual([
            true,
            true,
          ])
          expect(afterDetach.panes.map((pane: { connected: boolean }) => pane.connected)).toEqual([
            false,
            true,
          ])
          expect(afterDetach.logicalPaths).toEqual(beforeDetach.logicalPaths)
          expect(
            result.ownership.panes.filter((pane: { connected: boolean }) => pane.connected)
          ).toHaveLength(2)
          expect(result.composerSize[0]).toBeGreaterThan(0)
          expect(result.composerSize[1]).toBeGreaterThan(0)
          if (onPhone()) {
            expect(result.thumbnailSize?.[0]).toBeGreaterThan(0)
            expect(result.thumbnailSize?.[1]).toBeGreaterThan(0)
          }
        }
      }
    },
    150_000
  )

  it('returns a drawn picture to the originating composer in place of the original', async () => {
    const result = JSON.parse(
      await evalLong(
        `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms))
      const until = async fn => { for (let i = 0; i < 160; i++) { const value = fn(); if (value) return value; await wait(50) } throw new Error('UI did not appear') }
      const chats = window.__abeleTest.ChatService.getInstance()
      const previous = chats.activeTabId.value
      const tab = chats.createTab()
      let view
      const session = chats.getSession(tab)
      ${PANE_PRELUDE}
      let sourcePane, mirrorPane
      const safeTop = document.body.style.getPropertyValue('--safe-area-inset-top')
      document.body.style.setProperty('--safe-area-inset-top', '48px')
      try {
        const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 96, 64)
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'))
        const source = await app.vault.createBinary(${JSON.stringify(DIR)} + '/sample-draft.png', await blob.arrayBuffer())
        chats.pendingInput.value = { text: 'An unfinished message', tabId: tab, attachments: [source.path] }
        sourcePane = await makePane()
        mirrorPane = await makePane()
        app.workspace.setActiveLeaf(sourcePane, { focus: false })
        const thumb = await until(() => paneHost(sourcePane)?.querySelector('.abele-chat-input__attachments img'))
        thumb.click()
        const preview = await until(() => document.querySelector('.abele-gallery-viewer'))
        const headerTop = preview.querySelector('.abele-gallery-viewer__info').getBoundingClientRect().top
        const closeTop = preview.querySelector('.abele-gallery-viewer__close').getBoundingClientRect().top
        preview.querySelector('[data-icon="pen-line"], .lucide-pen-line').closest('.abele-obsidian-icon').click()
        view = await until(() => app.workspace.getLeavesOfType('abele-image-ink').map(l => l.view).find(v => v.image && v.session?.surface.width > 0))
        view.session.items.add([{ id: 'sample-mark', type: 'shape', kind: 'line', x1: 10, y1: 10, x2: 80, y2: 50, color: 'red', size: 4 }])
        if (!(await view.sendToChat(source))) throw new Error('The picture was not saved')
        await until(() => paneHost(sourcePane)?.querySelector('.abele-chat-input__attachments img')?.getAttribute('alt')?.includes('drawn'))
        const paths = [...paneHost(sourcePane).querySelectorAll('.abele-chat-input__attachments img')].map(i => i.alt)
        const logicalPaths = session.draft.value.attachments.map(file => file.path)
        const made = app.vault.getAbstractFileByPath(logicalPaths[0])
        const img = new Image(); img.src = app.vault.getResourcePath(made); await img.decode()
        const pixels = document.createElement('canvas'); pixels.width = 96; pixels.height = 64
        const c = pixels.getContext('2d'); c.drawImage(img, 0, 0)
        const point = [...c.getImageData(45, 30, 1, 1).data]
        const field = paneHost(sourcePane).querySelector('.abele-chat-input__field')
        const draft = field.querySelector('.cm-content')?.textContent || field.value || ''
        await capture('drawn-owner-and-mirror')
        return { paths, logicalPaths, draft, point, headerTop, closeTop, original: !!app.vault.getAbstractFileByPath(source.path), ownership: evidence(session) }
      } catch (e) { return { error: String(e?.stack || e), ownership: evidence(session) } }
      finally {
        document.body.style.setProperty('--safe-area-inset-top', safeTop)
        view?.leaf.detach()
        await chats.closeTab(tab)
        if (previous) chats.switchTab(previous)
        for (const leaf of ownedPanes) if (leaf.view.containerEl.isConnected) leaf.detach()
        if (previousLeaf?.view.containerEl.isConnected) app.workspace.setActiveLeaf(previousLeaf, { focus: false })
      }
    })()`,
        120_000
      )
    )
    console.log('drawn picture ownership', JSON.stringify(result))
    writeFileSync(join(SHOTS, 'drawn-ownership.json'), JSON.stringify(result, null, 2))
    expect(result.error).toBeUndefined()
    expect(result.headerTop).toBeGreaterThanOrEqual(48)
    expect(result.closeTop).toBeGreaterThanOrEqual(48)
    expect(result.paths).toHaveLength(1)
    expect(result.paths[0]).toContain('drawn')
    expect(result.draft).toContain('An unfinished message')
    expect(result.original).toBe(true)
    expect(result.point[1]).toBeLessThan(200)
    expect(result.logicalPaths).toHaveLength(1)
    expect(result.logicalPaths[0]).toContain('drawn')
    expect(result.ownership.panes).toHaveLength(2)
    for (const pane of result.ownership.panes) {
      expect(pane.connected).toBe(true)
      expect(pane.owner).toBe(true)
      expect(pane.sharesDraft).toBe(true)
      expect(pane.thumbnails).toEqual(result.paths)
    }
  }, 150_000)
})
