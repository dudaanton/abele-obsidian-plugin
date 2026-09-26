/**
 * Note widgets in a popout window.
 *
 * A popout has a document of its own, and the editor widgets used to be looked up in the main
 * window's only: a gallery opened in a popout was an empty box from the start, and the store
 * swept it out as an orphan on the next tab switch. Asked here of the real app: open a note in
 * a popout in Live Preview, switch to another tab, come back, and the gallery's
 * picture is still on screen with a size.
 *
 * The note and picture live in `Widget popout e2e/` for the length of this file and are
 * deleted after it. A picture of the popout goes to `/tmp/abele-popout/` — look at it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Widget popout e2e'
const SHOTS = '/tmp/abele-popout'

describe.skipIf(!available)('note widgets in a popout window', () => {
  beforeAll(() => {
    evalAsync(`(async () => {
      const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (old) await app.vault.delete(old, true)
      await app.vault.createFolder(${JSON.stringify(DIR)})
      const c = document.createElement('canvas'); c.width = 320; c.height = 200
      const x = c.getContext('2d'); x.fillStyle = '#2a7ab0'; x.fillRect(0, 0, 320, 200)
      const bytes = Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]), (ch) => ch.charCodeAt(0))
      await app.vault.createBinary(${JSON.stringify(DIR + '/p.png')}, bytes.buffer)
      await app.vault.create(${JSON.stringify(DIR + '/Gallery.md')},
        '# Gallery\\n\\n::abele-gallery::\\n![[' + ${JSON.stringify(DIR)} + '/p.png]]\\n\\nAfter.\\n')
      await app.vault.create(${JSON.stringify(DIR + '/Other.md')}, 'Other')
      return { ok: true }
    })()`)
  })

  afterAll(() => {
    evalAsync(`(async () => {
      for (const l of app.workspace.getLeavesOfType('markdown'))
        if (l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')})) l.detach()
      const f = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (f) await app.vault.delete(f, true)
      return { ok: true }
    })()`)
  })

  it('draws the gallery in Live Preview and keeps it through a tab switch', () => {
    const r = evalAsync<{
      error?: string
      popout?: boolean
      first?: { w: number; h: number; loaded: boolean } | null
      after?: { w: number; h: number; loaded: boolean } | null
      shot?: string
    }>(
      `(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const until = async (fn, ms = 10000) => {
        const deadline = Date.now() + ms
        while (Date.now() < deadline) { try { const v = fn(); if (v) return v } catch {} await wait(100) }
        return null
      }
      const remote = require('@electron/remote')
      const before = new Set(remote.BrowserWindow.getAllWindows().map((w) => w.id))
      const pop = app.workspace.openPopoutLeaf()
      let main = null
      try {
        await pop.setViewState({ type: 'markdown', state: { file: ${JSON.stringify(DIR + '/Gallery.md')}, mode: 'source', source: false }, active: true })
        const root = pop.view.containerEl
        pop.view.editor.setCursor({ line: 0, ch: 0 })
        const picture = () => {
          const img = root.querySelector('.abele-gallery img.abele-gallery__image')
          if (!img || !img.complete || !img.naturalWidth) return null
          const b = img.getBoundingClientRect()
          return b.width > 0 && b.height > 0 ? { w: Math.round(b.width), h: Math.round(b.height), loaded: true } : null
        }
        const first = await until(picture)
        main = app.workspace.getLeaf('tab')
        await main.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(DIR + '/Other.md')}))
        await wait(1200)
        app.workspace.setActiveLeaf(pop, { focus: true })
        await wait(1200)
        const after = await until(picture, 3000)
        let shot = 'no picture'
        try {
          // The popout is the window that was not there before it was opened.
          const win = remote.BrowserWindow.getAllWindows().find((w) => !before.has(w.id))
          const img = win && (await win.webContents.capturePage())
          if (img) { require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true }); shot = ${JSON.stringify(SHOTS)} + '/popout-live.png'; require('fs').writeFileSync(shot, img.toPNG()) }
        } catch {}
        return { popout: root.ownerDocument !== document, first, after, shot }
      } finally {
        // The popout closes with a leaf of the main window active, or the next note opened
        // anywhere would be looked for in a window that is gone.
        if (!main) main = app.workspace.getLeaf('tab')
        app.workspace.setActiveLeaf(main, { focus: true })
        pop.detach()
        await wait(500)
      }
    })()`,
      90_000
    )
    expect(r.error).toBeUndefined()
    expect(r.popout).toBe(true)
    expect(r.first).not.toBeNull()
    expect(r.after).not.toBeNull()
    expect(r.after!.w).toBeGreaterThan(50)
    expect(r.after!.h).toBeGreaterThan(50)
  })
})
