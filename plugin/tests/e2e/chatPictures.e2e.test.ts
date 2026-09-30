import { readFileSync } from 'node:fs'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'

targets('desktop', 'phone')
const HEIC = readFileSync(new URL('../fixtures/images/sample-gradient.heic', import.meta.url)).toString('base64')
const DIR = 'Sample image chat probe'
const available = isObsidianRunning() && hasTestApi()

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
    const result = JSON.parse(await evalLong(`(async () => {
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
    })()`, 150_000))
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

  it('returns a drawn picture to the originating composer in place of the original', async () => {
    const result = JSON.parse(await evalLong(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms))
      const until = async fn => { for (let i = 0; i < 160; i++) { const value = fn(); if (value) return value; await wait(50) } throw new Error('UI did not appear') }
      const chats = window.__abeleTest.ChatService.getInstance()
      const previous = chats.activeTabId.value
      const tab = chats.createTab()
      let view
      const safeTop = document.body.style.getPropertyValue('--safe-area-inset-top')
      document.body.style.setProperty('--safe-area-inset-top', '48px')
      try {
        const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 96, 64)
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'))
        const source = await app.vault.createBinary(${JSON.stringify(DIR)} + '/sample-draft.png', await blob.arrayBuffer())
        chats.pendingInput.value = { text: 'An unfinished message', tabId: tab, attachments: [source.path] }
        await chats.revealSidebar()
        const thumb = await until(() => document.querySelector('.abele-chat-input__attachments img'))
        thumb.click()
        const preview = await until(() => document.querySelector('.abele-gallery-viewer'))
        const headerTop = preview.querySelector('.abele-gallery-viewer__info').getBoundingClientRect().top
        const closeTop = preview.querySelector('.abele-gallery-viewer__close').getBoundingClientRect().top
        preview.querySelector('[data-icon="pen-line"], .lucide-pen-line').closest('.abele-obsidian-icon').click()
        view = await until(() => app.workspace.getLeavesOfType('abele-image-ink').map(l => l.view).find(v => v.image && v.session?.surface.width > 0))
        view.session.items.add([{ id: 'sample-mark', type: 'shape', kind: 'line', x1: 10, y1: 10, x2: 80, y2: 50, color: 'red', size: 4 }])
        if (!(await view.sendToChat(source))) throw new Error('The picture was not saved')
        await until(() => document.querySelector('.abele-chat-input__attachments img')?.getAttribute('alt')?.includes('drawn'))
        const paths = [...document.querySelectorAll('.abele-chat-input__attachments img')].map(i => i.alt)
        const made = app.vault.getFiles().find(f => f.path.startsWith(${JSON.stringify(DIR)}) && f.path.includes('drawn'))
        const img = new Image(); img.src = app.vault.getResourcePath(made); await img.decode()
        const pixels = document.createElement('canvas'); pixels.width = 96; pixels.height = 64
        const c = pixels.getContext('2d'); c.drawImage(img, 0, 0)
        const point = [...c.getImageData(45, 30, 1, 1).data]
        const field = document.querySelector('.abele-chat-input__field')
        const draft = field.querySelector('.cm-content')?.textContent || field.value || ''
        return { paths, draft, point, headerTop, closeTop, original: !!app.vault.getAbstractFileByPath(source.path) }
      } catch (e) { return { error: String(e?.stack || e) } }
      finally {
        document.body.style.setProperty('--safe-area-inset-top', safeTop)
        view?.leaf.detach()
        await chats.closeTab(tab)
        if (previous) chats.switchTab(previous)
      }
    })()`, 120_000))
    expect(result.error).toBeUndefined()
    expect(result.headerTop).toBeGreaterThanOrEqual(48)
    expect(result.closeTop).toBeGreaterThanOrEqual(48)
    expect(result.paths).toHaveLength(1)
    expect(result.paths[0]).toContain('drawn')
    expect(result.draft).toContain('An unfinished message')
    expect(result.original).toBe(true)
    expect(result.point[1]).toBeLessThan(200)
  }, 150_000)
})
