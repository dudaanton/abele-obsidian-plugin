/**
 * A groups property in the running app: a group added through the list of the vault's groups —
 * the most used one offered first — lands in the note's frontmatter as a wikilink, beside the one
 * already there kept as written; its pill opens the group note; its cross takes it off again. On
 * a phone (`emulateMobile`) the pills wrap inside their cell and the list opens from the field.
 *
 * Everything is written into a folder of its own and deleted after, with the settings put back.
 * Pictures go to `/tmp/abele-property-groups/` — look at them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  hasTestApi,
  isObsidianRunning,
  evalRaw,
  evalJson,
  reloadApp,
  setFocusEmulation,
} from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { onPhone } from './helpers/target'

const available = isObsidianRunning() && hasTestApi() && !onPhone()
const PHONE = { width: 390, height: 844 }
const DIR = 'Property groups e2e'
const NOTE = `${DIR}/Sample member.md`
const KEY = 'pg-groups'
const SHOTS = '/tmp/abele-property-groups'
const GROUPS = [
  'Sample orchard',
  'Sample workshop',
  'Sample bakery with a long name',
  'Sample pond',
]

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      try { const v = await fn(); if (v) return v } catch {}
      await wait(100)
    }
    return null
  }
  const shoot = async (name) => {
    require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
    const path = ${JSON.stringify(SHOTS)} + '/' + name + '.png'
    const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
    if (img) require('fs').writeFileSync(path, img.toPNG())
    return path
  }
  const open = async () => {
    const leaf = app.workspace.getLeaf(false)
    await leaf.setViewState({ type: 'markdown', state: { file: ${JSON.stringify(NOTE)}, mode: 'source', source: false }, active: true })
    app.workspace.revealLeaf(leaf)
    return leaf
  }
  const cell = (leaf, key) => leaf.view.containerEl.querySelector('.metadata-property[data-property-key="' + key + '"] .metadata-property-value')
  const stored = (key) => app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))?.frontmatter?.[key]
  const raw = () => app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  const settle = async (key, want) => (await until(() => same(stored(key), want), 8000)) ? want : stored(key) ?? null
  // Typed as a keyboard types, again until the list is up: a window not in front can take the
  // focus late.
  const offer = async (leaf, text) => {
    const field = () => cell(leaf, '${KEY}')?.querySelector('.abele-property-groups__input')
    const input = await until(field)
    if (!input) throw new Error('no field')
    return await until(() => {
      const found = [...document.querySelectorAll('.suggestion-container .suggestion-item')]
      if (found.length) return found
      input.blur()
      input.focus()
      input.value = text
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return null
    })
  }
  const titles = (items) => (items ?? []).map((i) => i.querySelector('.suggestion-title')?.textContent)
`

const run = <T>(body: string, timeout = 60_000): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    timeout
  )

interface Saved {
  widgets: boolean
  groups: string[]
  shown: string | null
}

const windowSize = (): [number, number] =>
  evalJson<[number, number]>(
    `require('@electron/remote').getCurrentWindow().getContentSize()`,
    30_000
  )

const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await new Promise((resolve) => setTimeout(resolve, 1500))
}

/** The note starts in one group, written with an alias, which has to survive every write. */
const FRONTMATTER = `---\\n${KEY}:\\n  - "[[${DIR}/${GROUPS[3]}|Pond]]"\\n---\\n\\nBody.\\n`

describe.skipIf(!available)('groups properties', () => {
  let saved: Saved | null = null

  beforeAll(() => {
    // A pool window is never the one in front: without this, the field typed into is not the
    // page's active element to Obsidian, and the list never opens.
    setFocusEmulation(true)
    saved = evalJson<Saved>(
      `(() => {
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        return {
          widgets: cfg.propertyWidgets,
          groups: [...(cfg.groupProperties ?? [])],
          shown: app.vault.getConfig('propertiesInDocument') ?? null,
        }
      })()`,
      30_000
    )
    evalRaw(
      `(async () => {
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        app.vault.setConfig('propertiesInDocument', 'visible')
        cfg.propertyWidgets = true
        cfg.groupProperties = ['${KEY}']
        await cfg.saveSettings()
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        const groups = ${JSON.stringify(GROUPS)}
        for (const g of groups) await app.vault.create(${JSON.stringify(DIR)} + '/' + g + '.md', 'A sample group.\\n')
        // The workshop has two members, the orchard one: the workshop is offered first.
        const members = [['Member a', ['[[' + groups[1] + ']]', '[[' + groups[0] + ']]']], ['Member b', ['[[' + groups[1] + ']]']]]
        for (const [name, links] of members)
          await app.vault.create(${JSON.stringify(DIR)} + '/' + name + '.md', '---\\n${KEY}:\\n' + links.map((l) => '  - "' + l + '"').join('\\n') + '\\n---\\n')
        await app.vault.create(${JSON.stringify(NOTE)}, '${FRONTMATTER}')
        for (let i = 0; i < 100 && !app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(${JSON.stringify(DIR)} + '/Member b.md'))?.frontmatter; i++)
          await new Promise((r) => setTimeout(r, 100))
        await new Promise((r) => setTimeout(r, 1000))
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  afterAll(() => {
    setFocusEmulation(false)
    evalRaw(
      `(async () => {
        for (const l of app.workspace.getLeavesOfType('markdown'))
          if (l.view.file?.path?.startsWith(${JSON.stringify(DIR)})) l.detach()
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        const saved = ${JSON.stringify(saved)}
        if (saved) {
          cfg.propertyWidgets = saved.widgets
          cfg.groupProperties = saved.groups
          if (saved.shown) app.vault.setConfig('propertiesInDocument', saved.shown)
          await cfg.saveSettings()
        }
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  it('adds a group from the list, opens it from its pill, and takes it off', () => {
    const r = run<{
      error?: string
      offered: (string | null)[]
      steps: unknown[]
      text: string
      pills: string[]
      opened: string | null
    }>(`
      const leaf = await open()
      await until(() => cell(leaf, '${KEY}')?.querySelector('.abele-property-groups'))
      const pond = '[[${DIR}/${GROUPS[3]}|Pond]]'
      const steps = [stored('${KEY}')]
      const items = await offer(leaf, '')
      const offered = titles(items)
      const workshop = (items ?? []).find((i) => i.querySelector('.suggestion-title')?.textContent === '${GROUPS[1]}')
      if (!workshop) throw new Error('the workshop was not offered: ' + JSON.stringify(offered))
      workshop.click()
      steps.push(await settle('${KEY}', [pond, '[[${GROUPS[1]}]]']))
      const text = await raw()
      await wait(300)
      const pills = [...cell(leaf, '${KEY}').querySelectorAll('.multi-select-pill-content')].map((p) => p.textContent)
      await shoot('desktop')
      const link = cell(leaf, '${KEY}').querySelector('.multi-select-pill[data-group="${DIR}/${GROUPS[1]}.md"] .internal-link')
      if (!link) throw new Error('no workshop pill')
      link.click()
      const opened = await until(() => {
        const f = app.workspace.getActiveFile()
        return f?.path === '${DIR}/${GROUPS[1]}.md' && f.path
      })
      const back = await open()
      const x = await until(() => cell(back, '${KEY}')?.querySelector('.multi-select-pill[data-group="${DIR}/${GROUPS[1]}.md"] .multi-select-pill-remove-button'))
      if (!x) throw new Error('no cross on the workshop pill')
      x.click()
      steps.push(await settle('${KEY}', [pond]))
      return { offered, steps, text, pills, opened }
    `)
    expect(r.error).toBeUndefined()
    expect(r.offered[0]).toBe(GROUPS[1])
    expect(r.offered).not.toContain(GROUPS[3])
    expect(r.steps).toEqual([
      [`[[${DIR}/${GROUPS[3]}|Pond]]`],
      [`[[${DIR}/${GROUPS[3]}|Pond]]`, `[[${GROUPS[1]}]]`],
      [`[[${DIR}/${GROUPS[3]}|Pond]]`],
    ])
    // Stored the way Obsidian writes a list of links: one per line, quoted.
    expect(r.text).toContain(`  - "[[${GROUPS[1]}]]"`)
    expect(r.text).toContain(`  - "[[${DIR}/${GROUPS[3]}|Pond]]"`)
    expect(r.pills).toEqual(['Pond', GROUPS[1]])
    expect(r.opened).toBe(`${DIR}/${GROUPS[1]}.md`)
  })

  describe('on a phone', () => {
    let size: [number, number] = [0, 0]

    beforeAll(async () => {
      size = windowSize()
      await reloadApp('app.emulateMobile(true)')
      await setWindowSize(PHONE.width, PHONE.height)
    }, 180_000)

    afterAll(async () => {
      // The window first: leaving emulation reloads the app and takes the viewport from the
      // window at that moment.
      if (size[0]) await setWindowSize(size[0], size[1])
      await reloadApp('app.emulateMobile(false)')
    }, 180_000)

    it('wraps its pills inside the cell and opens the list from the field', () => {
      const r = run<{
        error?: string
        mobile: boolean
        rows: number
        overflow: number
        offered: (string | null)[]
        listInside: boolean
      }>(`
        const mobile = app.isMobile
        await until(() => app.workspace.layoutReady)
        await wait(1000)
        // Every group at once, so the pills cannot fit on one line.
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
        await app.fileManager.processFrontMatter(file, (fm) => {
          fm['${KEY}'] = ${JSON.stringify(GROUPS.slice(0, 3).map((g) => `[[${g}]]`))}.concat(fm['${KEY}'] ?? [])
        })
        const leaf = await open()
        await until(() => cell(leaf, '${KEY}')?.querySelectorAll('.multi-select-pill').length === 4)
        await wait(500)
        const c = cell(leaf, '${KEY}')
        const box = c.getBoundingClientRect()
        const pills = [...c.querySelectorAll('.multi-select-pill')].map((p) => p.getBoundingClientRect())
        const rows = new Set(pills.map((p) => Math.round(p.top))).size
        const overflow = Math.max(0, ...pills.map((p) => p.right - box.right))
        const items = await offer(leaf, 'member')
        const offered = titles(items)
        const list = document.querySelector('.suggestion-container')?.getBoundingClientRect()
        const listInside = !!list && list.left >= 0 && list.right <= window.innerWidth + 1
        await shoot('phone')
        document.activeElement?.blur?.()
        return { mobile, rows, overflow, offered, listInside }
      `)
      expect(r.error).toBeUndefined()
      expect(r.mobile).toBe(true)
      expect(r.rows).toBeGreaterThan(1)
      expect(r.overflow).toBeLessThanOrEqual(1)
      expect(r.offered).toContain('Member a')
      expect(r.listInside).toBe(true)
    })
  })
})
