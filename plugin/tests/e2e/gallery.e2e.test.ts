/**
 * The gallery in the running app: a block of `::abele-gallery::` and image embeds under it,
 * shown in reading view and in Live Preview, on a desktop and on a phone.
 *
 * Every case asks the same thing of the page — is there a picture on screen, loaded, with a
 * size — because a gallery that mounts and draws nothing passes every other check.
 *
 * The notes and pictures live in `Gallery e2e/` for the length of this file and are deleted
 * after it, so the fixture vault ends with nothing but `ScaleTest/` in it. Pictures of the
 * screen go to `/tmp/abele-gallery/` — look at them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Gallery e2e'
const SHOTS = '/tmp/abele-gallery'
const PHONE = { width: 390, height: 844 }
const UUID = 'b0146371-e7b4-499c-a591-281a73c9bcab'

/** The note as it was written: one picture, its full path with a folder, a uuid for a name. */
const NOTES: Record<string, string> = {
  single: `# Single\n\n::abele-gallery::\n![[${DIR}/Attachments/${UUID}.png]]\n\nAfter the gallery.\n`,
  several: `# Several\n\n::abele-gallery::\n![[${DIR}/Attachments/${UUID}.png]]\n![[${DIR}/Attachments/Deep/red.png|300]]\n\n![[green.png]]\n\nAfter.\n`,
  late: `# Late\n\n::abele-gallery::\n![[${DIR}/Attachments/late.png]]\n\nAfter.\n`,
}
const notePath = (name: string) => `${DIR}/${name}.md`

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 15000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      try { const v = fn(); if (v) return v } catch {}
      await wait(100)
    }
    return null
  }
  const shoot = async (name) => {
    require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
    const path = ${JSON.stringify(SHOTS)} + '/' + name + '.png'
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
        if (img) { require('fs').writeFileSync(path, img.toPNG()); return path }
      } catch (e) { await wait(500) }
    }
    return 'no picture'
  }
  const openNote = async (path, mode) => {
    const file = app.vault.getAbstractFileByPath(path)
    const leaf = app.workspace.getLeaf(false)
    await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode, source: false }, active: true })
    app.workspace.revealLeaf(leaf)
    return leaf
  }
  const rootOf = (leaf, mode) =>
    leaf.view.containerEl.querySelector(mode === 'preview' ? '.markdown-preview-view' : '.cm-content')
  /** Each picture the gallery shows: loaded, with a size on screen. */
  const pictures = (root) =>
    Array.from(root.querySelectorAll('.abele-gallery img.abele-gallery__image')).map((img) => {
      const r = img.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height), loaded: img.complete && img.naturalWidth > 0 }
    })
  const seen = (root, n) => {
    const p = pictures(root)
    return p.length === n && p.every((x) => x.loaded && x.w > 0 && x.h > 0) ? p : null
  }
  /** What is on screen where the gallery is: the gallery count, its box, its pictures. */
  const report = async (root, n, shot) => {
    await until(() => seen(root, n))
    const g = root.querySelectorAll('.abele-gallery')
    const box = g[0]?.getBoundingClientRect()
    return {
      galleries: g.length,
      box: box ? { w: Math.round(box.width), h: Math.round(box.height) } : null,
      pictures: pictures(root),
      errors: root.querySelectorAll('.abele-gallery__image-error').length,
      marker: root.textContent.includes('::abele-gallery'),
      shot: await shoot(shot),
    }
  }
`

type Report = {
  error?: string
  galleries: number
  box: { w: number; h: number } | null
  pictures: Array<{ w: number; h: number; loaded: boolean }>
  errors: number
  marker: boolean
  shot: string
}

const show = (note: string, mode: 'preview' | 'source', n: number, shot: string): Report =>
  evalAsync<Report>(
    `(async () => {
    ${PRELUDE}
    const leaf = await openNote(${JSON.stringify(notePath(note))}, ${JSON.stringify(mode)})
    if (${JSON.stringify(mode)} === 'source') leaf.view.editor.setCursor({ line: 0, ch: 0 })
    return await report(rootOf(leaf, ${JSON.stringify(mode)}), ${n}, ${JSON.stringify(shot)})
  })()`,
    90_000
  )

const expectShown = (r: Report, n: number) => {
  expect(r.error).toBeUndefined()
  expect(r.galleries).toBe(1)
  expect(r.marker).toBe(false)
  expect(r.errors).toBe(0)
  expect(r.pictures).toHaveLength(n)
  for (const p of r.pictures) {
    expect(p.loaded).toBe(true)
    expect(p.w).toBeGreaterThan(50)
    expect(p.h).toBeGreaterThan(50)
  }
  expect(r.box!.h).toBeGreaterThan(50)
}

const windowSize = (): [number, number] =>
  evalJson<[number, number]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)

const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await pause(1500)
}

/** A small PNG of one colour, written into the vault. */
const writePicture = (path: string, colour: string) => `
  {
    const c = document.createElement('canvas'); c.width = 320; c.height = 200
    const x = c.getContext('2d'); x.fillStyle = ${JSON.stringify(colour)}; x.fillRect(0, 0, 320, 200)
    const bytes = Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]), (ch) => ch.charCodeAt(0))
    const folder = ${JSON.stringify(path)}.split('/').slice(0, -1).join('/')
    if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder).catch(() => {})
    await app.vault.createBinary(${JSON.stringify(path)}, bytes.buffer)
  }
`

describe.skipIf(!available)('the gallery', () => {
  beforeAll(async () => {
    evalAsync(`(async () => {
      const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (old) await app.vault.delete(old, true)
      await app.vault.createFolder(${JSON.stringify(DIR)})
      ${writePicture(`${DIR}/Attachments/${UUID}.png`, '#2a7ab0')}
      ${writePicture(`${DIR}/Attachments/Deep/red.png`, '#c0392b')}
      ${writePicture(`${DIR}/green.png`, '#27ae60')}
      for (const [name, text] of Object.entries(${JSON.stringify(NOTES)}))
        await app.vault.create(${JSON.stringify(DIR)} + '/' + name + '.md', text)
      return { ok: true }
    })()`)
  })

  afterAll(async () => {
    evalAsync(`(async () => {
      for (const l of app.workspace.getLeavesOfType('markdown'))
        if (l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')})) l.detach()
      const f = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (f) await app.vault.delete(f, true)
      return { ok: true }
    })()`)
  })

  it('shows the one picture under the marker in reading view', () => {
    expectShown(show('single', 'preview', 1, 'single-reading'), 1)
  })

  it('shows the one picture under the marker in Live Preview', () => {
    expectShown(show('single', 'source', 1, 'single-live'), 1)
  })

  it('shows several pictures, with a width and in subfolders, in both views', () => {
    expectShown(show('several', 'preview', 3, 'several-reading'), 3)
    expectShown(show('several', 'source', 3, 'several-live'), 3)
  })

  it('still shows the picture after the note is left and opened again', () => {
    for (const mode of ['preview', 'source'] as const) {
      show('single', mode, 1, `again-${mode}-1`)
      show('several', mode, 3, `again-${mode}-2`)
      expectShown(show('single', mode, 1, `again-${mode}-3`), 1)
    }
  })

  it('still shows the picture in reading view after scrolling away, switching tabs and back', () => {
    // Reading mode takes a section far from the screen out of the page and puts the same
    // element back later; switching tabs in between used to leave an empty box behind.
    const r = evalAsync<Report>(
      `(async () => {
      ${PRELUDE}
      const filler = Array.from({ length: 300 }, (_, i) => 'Paragraph ' + i + ' of text to scroll past.').join('\\n\\n')
      const path = ${JSON.stringify(notePath('long'))}
      const text = ${JSON.stringify(NOTES.single)} + '\\n' + filler + '\\n'
      const f = app.vault.getAbstractFileByPath(path) || (await app.vault.create(path, text))
      const leaf = await openNote(path, 'preview')
      const root = rootOf(leaf, 'preview')
      if (!(await until(() => seen(root, 1)))) return { error: 'no picture at first' }
      root.scrollTop = 1e7
      if (!(await until(() => !root.querySelector('.abele-gallery')))) return { error: 'the section never left the page' }
      const other = app.workspace.getLeaf('tab')
      await other.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(notePath('several'))}))
      await wait(1200)
      app.workspace.setActiveLeaf(leaf, { focus: true })
      await wait(1200)
      other.detach()
      root.scrollTop = 0
      await wait(500)
      return await report(root, 1, 'scrolled-back')
    })()`,
      90_000
    )
    expectShown(r, 1)
  })

  it('shows a picture that arrives in the vault after the note was opened', () => {
    for (const mode of ['preview', 'source'] as const) {
      const r = evalAsync<Report>(
        `(async () => {
        ${PRELUDE}
        const f = app.vault.getAbstractFileByPath(${JSON.stringify(`${DIR}/Attachments/late.png`)})
        if (f) await app.vault.delete(f)
        const leaf = await openNote(${JSON.stringify(notePath('late'))}, ${JSON.stringify(mode)})
        if (${JSON.stringify(mode)} === 'source') leaf.view.editor.setCursor({ line: 0, ch: 0 })
        const root = rootOf(leaf, ${JSON.stringify(mode)})
        if (!(await until(() => root.querySelector('.abele-gallery')))) return { error: 'no gallery' }
        await wait(500)
        ${writePicture(`${DIR}/Attachments/late.png`, '#8e44ad')}
        return await report(root, 1, 'late-' + ${JSON.stringify(mode)})
      })()`,
        90_000
      )
      expectShown(r, 1)
    }
  })

  describe('on a phone', () => {
    let size: [number, number] = [0, 0]

    beforeAll(async () => {
      size = windowSize()
      await reloadApp('app.emulateMobile(true)')
      await setWindowSize(PHONE.width, PHONE.height)
      await reloadApp('window.location.reload()')
      // A hidden window hands back no frame after a reload until its size is nudged.
      await setWindowSize(PHONE.width + 2, PHONE.height + 2)
      await setWindowSize(PHONE.width, PHONE.height)
    }, 300_000)

    afterAll(async () => {
      if (size[0]) await setWindowSize(size[0], size[1])
      await reloadApp('app.emulateMobile(false)')
    }, 180_000)

    it('shows the picture in reading view and in Live Preview, inside the screen', () => {
      for (const mode of ['preview', 'source'] as const) {
        const r = show('single', mode, 1, `phone-${mode}`)
        expectShown(r, 1)
        expect(r.box!.w).toBeLessThanOrEqual(PHONE.width)
      }
    })
  })
})
