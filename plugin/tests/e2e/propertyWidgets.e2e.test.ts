/**
 * The plugin's drawing of properties in the running app: file cards with their pictures, a
 * wallet's balance, a sum in a number field — in Live Preview, reading view and the file
 * properties sidebar — and Obsidian's own drawing back, without a reload, when it is switched off.
 *
 * Everything is written into a folder of its own for the length of this file and deleted after
 * it, with the property types it set; the fixture vault ends with nothing but `ScaleTest/`.
 * Pictures go to `/tmp/abele-props/` — look at them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildPlainPdf } from '../fixtures/books/pdfFixture'
import { tablePng } from '../fixtures/books/figureBook'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Property widgets e2e'
const SHOTS = '/tmp/abele-props'
const NOTE = `${DIR}/Card note.md`
const TX = `${DIR}/Lunch.md`
const TYPES = { 'pw-file': 'file', 'pw-files': 'files' }

/** A book with a cover, the way publishers declare one. */
function coveredEpub(): Uint8Array {
  const text: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    'OEBPS/content.opf': `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:abele-covered</dc:identifier><dc:title>Covered</dc:title><dc:language>en</dc:language></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/></manifest><spine><itemref idref="c1"/></spine></package>`,
    'OEBPS/c1.xhtml': `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body><p>Text.</p></body></html>`,
  }
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const [path, value] of Object.entries(text))
    entries[path] = [strToU8(value), { level: path === 'mimetype' ? 0 : 6 }]
  entries['OEBPS/cover.png'] = [tablePng(120, 180), { level: 6 }]
  return zipSync(entries)
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

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
  const cfg = window.__abeleTest.AbeleConfig.getInstance()
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
  const open = async (path, mode = 'source') => {
    const file = app.vault.getAbstractFileByPath(path)
    const leaf = app.workspace.getLeaf(false)
    await leaf.setViewState({ type: 'markdown', state: { file: path, mode, source: false }, active: true })
    app.workspace.revealLeaf(leaf)
    return leaf
  }
  const row = (root, key) => root.querySelector('.metadata-property[data-property-key="' + key + '"] .metadata-property-value')
  const setOn = async (on) => { cfg.propertyWidgets = on; await cfg.saveSettings(); await wait(400) }
`

const run = <T>(body: string, timeout = 60_000): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    timeout
  )

describe.skipIf(!available)('properties drawn by the plugin', () => {
  beforeAll(() => {
    const files = {
      'paper.pdf': b64(buildPlainPdf()),
      'covered.epub': b64(coveredEpub()),
      'poster.png': b64(tablePng(200, 120)),
    }
    const notes = {
      'Wallet.md':
        '---\ntype: account\naccountType: asset\ncurrency: EUR\nstartingBalance: 100\n---\n',
      'Food.md': '---\ntype: account\naccountType: expense\ncurrency: EUR\n---\n',
      'Lunch.md':
        '---\ntype: transaction\ndate: 2026-01-02\nfrom: "[[Wallet]]"\nto: "[[Food]]"\namount: 30\n---\n',
      'Card note.md': `---\ncover: "[[poster.png]]"\npw-file: "[[paper.pdf]]"\npw-files:\n  - "[[covered.epub]]"\n  - "[[poster.png]]"\npw-total: 5\n---\n\nBody.\n`,
    }
    evalRaw(
      `(async () => {
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        window.__abelePropsSaved = cfg.propertyWidgets
        // The panel in the note is what is looked at; this vault may keep it hidden.
        window.__abelePropsShown = app.vault.getConfig('propertiesInDocument')
        app.vault.setConfig('propertiesInDocument', 'visible')
        cfg.propertyWidgets = true
        await cfg.saveSettings()
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        for (const [name, data] of Object.entries(${JSON.stringify(files)})) {
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
          await app.vault.createBinary(${JSON.stringify(DIR)} + '/' + name, bytes.buffer)
        }
        for (const [name, text] of Object.entries(${JSON.stringify(notes)}))
          await app.vault.create(${JSON.stringify(DIR)} + '/' + name, text)
        for (const [key, type] of Object.entries(${JSON.stringify(TYPES)}))
          await app.metadataTypeManager.setType(key, type)
        await new Promise((r) => setTimeout(r, 1500))
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const l of app.workspace.getLeavesOfType('markdown'))
          if (l.view.file?.path?.startsWith(${JSON.stringify(DIR)})) l.detach()
        for (const l of app.workspace.getLeavesOfType('file-properties')) l.detach()
        for (const key of Object.keys(${JSON.stringify(TYPES)})) await app.metadataTypeManager.unsetType(key)
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.propertyWidgets = window.__abelePropsSaved ?? true
        delete window.__abelePropsSaved
        if (window.__abelePropsShown) app.vault.setConfig('propertiesInDocument', window.__abelePropsShown)
        delete window.__abelePropsShown
        await cfg.saveSettings()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      60_000
    )
  })

  it('draws File, Files and cover as cards, each with its picture', () => {
    const r = run<{
      error?: string
      file?: string
      fileImg?: string
      files?: string[]
      epubImg?: string
      cover?: string
      coverImg?: string
      menu?: boolean
      shot?: string
    }>(`
      const leaf = await open(${JSON.stringify(NOTE)})
      const root = leaf.view.containerEl
      await until(() => row(root, 'pw-files')?.querySelectorAll('.abele-card').length === 2)
      await until(() => row(root, 'pw-file')?.querySelector('img') && row(root, 'pw-files')?.querySelector('img'))
      await wait(300)
      const file = row(root, 'pw-file')
      const files = row(root, 'pw-files')
      const cover = row(root, 'cover')
      return {
        file: file?.querySelector('.abele-card__name')?.textContent,
        fileImg: file?.querySelector('img')?.getAttribute('src')?.slice(0, 23),
        files: [...(files?.querySelectorAll('.abele-card__name') ?? [])].map((n) => n.textContent),
        epubImg: files?.querySelector('img')?.getAttribute('src')?.slice(0, 5),
        cover: cover?.querySelector('.abele-card__name')?.textContent,
        coverImg: cover?.querySelector('img')?.getAttribute('src'),
        menu: app.metadataTypeManager.registeredTypeWidgets.file.reservedKeys === undefined,
        shot: await shoot('desktop-live-preview'),
      }
    `)
    expect(r.error).toBeUndefined()
    expect(r.file).toBe('paper.pdf')
    expect(r.fileImg).toBe('data:image/jpeg;base64,')
    expect(r.files).toEqual(['covered.epub', 'poster.png'])
    expect(r.epubImg).toBe('blob:')
    expect(r.cover).toBe('poster.png')
    expect(r.coverImg).toContain('poster.png')
    expect(r.menu).toBe(true)
  })

  it('shows the balance of the wallet a transaction comes from, and none for a category', () => {
    const r = run<{ error?: string; from?: string; to?: string | null }>(`
      const leaf = await open(${JSON.stringify(TX)})
      const root = leaf.view.containerEl
      const badge = await until(() => row(root, 'from')?.querySelector('.abele-property-balance'))
      return {
        from: badge?.textContent,
        to: row(root, 'to')?.querySelector('.abele-property-balance')?.textContent ?? null,
      }
    `)
    expect(r.error).toBeUndefined()
    expect(r.from).toMatch(/^70\.00 EUR$/)
    expect(r.to).toBeNull()
  })

  it('works out a sum typed into a number property and keeps the answer', () => {
    const r = run<{ error?: string; type?: string; stored?: unknown }>(`
      const leaf = await open(${JSON.stringify(NOTE)})
      const root = leaf.view.containerEl
      const input = await until(() => row(root, 'pw-total')?.querySelector('input'))
      input.focus()
      input.value = '120+35*2'
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
      await until(() => app.metadataCache.getFileCache(file)?.frontmatter?.['pw-total'] === 190)
      return { type: input.type, stored: app.metadataCache.getFileCache(file)?.frontmatter?.['pw-total'] }
    `)
    expect(r.error).toBeUndefined()
    expect(r.type).toBe('text')
    expect(r.stored).toBe(190)
  })

  it('draws the cards in reading view and in the file properties sidebar too', () => {
    const r = run<{ error?: string; reading?: number; sidebar?: number; shot?: string }>(`
      const leaf = await open(${JSON.stringify(NOTE)}, 'preview')
      const reading = await until(() => row(leaf.view.containerEl.querySelector('.markdown-reading-view'), 'pw-files')?.querySelectorAll('.abele-card').length)
      const shot = await shoot('desktop-reading')
      const side = app.workspace.getRightLeaf(false)
      await side.setViewState({ type: 'file-properties', active: true })
      app.workspace.revealLeaf(side)
      await open(${JSON.stringify(NOTE)})
      const sidebar = await until(() => row(side.view.containerEl, 'pw-files')?.querySelectorAll('.abele-card').length)
      await shoot('desktop-sidebar')
      side.detach()
      return { reading, sidebar, shot }
    `)
    expect(r.error).toBeUndefined()
    expect(r.reading).toBe(2)
    expect(r.sidebar).toBe(2)
  })

  it('gives Obsidian its own drawing back when switched off, and the cards when on again', () => {
    const r = run<{
      error?: string
      offCards?: number
      offNumber?: string
      offFiles?: boolean
      onCards?: number
      shot?: string
    }>(`
      const leaf = await open(${JSON.stringify(NOTE)}, 'source')
      const root = leaf.view.containerEl
      await until(() => row(root, 'pw-files')?.querySelector('.abele-card'))
      await setOn(false)
      await until(() => !root.querySelector('.metadata-container .abele-card'))
      const offCards = root.querySelectorAll('.metadata-container .abele-card').length
      const offNumber = row(root, 'pw-total')?.querySelector('input')?.type
      const offFiles = !!row(root, 'pw-files')?.querySelector('.multi-select-container')
      const shot = await shoot('desktop-off')
      await setOn(true)
      const onCards = await until(() => root.querySelectorAll('.metadata-container .abele-card').length >= 4 && root.querySelectorAll('.metadata-container .abele-card').length)
      return { offCards, offNumber, offFiles, onCards, shot }
    `)
    expect(r.error).toBeUndefined()
    expect(r.offCards).toBe(0)
    expect(r.offNumber).toBe('number')
    expect(r.offFiles).toBe(true)
    expect(r.onCards).toBe(4)
  })
})
