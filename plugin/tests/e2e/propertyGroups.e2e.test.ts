/**
 * A groups property in the running app: Obsidian's own list editor, typed into as a keyboard
 * types — `[[` brings up Obsidian's link suggester and a note picked there is added, a note that
 * is not a group yet and a note not written yet go in too — and the button beside it, whose list
 * offers the most used group first and adds it. A pill opens its note. Every step is read back
 * from the note's frontmatter and its text, quoting included. On a phone (`emulateMobile`) the
 * pills wrap inside their cell, the button fits beside them and opens its list.
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
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi() && !onPhone()
const PHONE = { width: 390, height: 844 }
const DIR = 'Property groups e2e'
const NOTE = `${DIR}/Sample member.md`
const KEY = 'pg-groups'
const SHOTS = shotDir('abele-property-groups')
const GROUPS = [
  'Sample orchard',
  'Sample workshop',
  'Sample bakery with a long name',
  'Sample pond',
]
const PLAIN = 'Sample plain note'

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
  const cdp = require('@electron/remote').getCurrentWebContents().debugger
  try { cdp.attach('1.3') } catch {}
  // Real key input through the DevTools protocol, into the list editor's own field.
  const type = async (leaf, text) => {
    const input = await until(() => cell(leaf, '${KEY}')?.querySelector('.multi-select-input'))
    if (!input) throw new Error('no list field')
    input.focus()
    if (!(await until(() => document.activeElement === input, 3000))) throw new Error('the list field took no focus')
    for (const part of text.split('|')) {
      await cdp.sendCommand('Input.insertText', { text: part })
      await wait(400)
    }
  }
  const enter = async () => {
    const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
    await cdp.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key })
    await cdp.sendCommand('Input.dispatchKeyEvent', { type: 'char', ...key, text: '\\r' })
    await cdp.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
    await wait(400)
  }
  const suggestions = () => [...document.querySelectorAll('.suggestion-container .suggestion-item')]
  const pills_ = (leaf) => [...cell(leaf, '${KEY}').querySelectorAll('.multi-select-pill-content')].map((p) => p.textContent)
  const titles = (items) => (items ?? []).map((i) => i.querySelector('.suggestion-title')?.textContent ?? i.textContent)
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
        // A note no other note names as a group yet.
        await app.vault.create(${JSON.stringify(DIR)} + '/${PLAIN}.md', 'Not a group yet.\\n')
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

  it('takes [[ links typed into Obsidian’s own list, any note or none, and the button’s groups', () => {
    const r = run<{
      error?: string
      linkList: (string | null)[]
      offered: (string | null)[]
      steps: unknown[]
      text: string
      pills: (string | null)[]
      opened: string | null
    }>(`
      const leaf = await open()
      await until(() => cell(leaf, '${KEY}')?.querySelector('.abele-property-groups__pick'))
      const pond = '[[${DIR}/${GROUPS[3]}|Pond]]'
      const steps = [stored('${KEY}')]
      // A note that is no group yet, through Obsidian's own link suggester: Enter takes the
      // line, Enter again adds the pill.
      await type(leaf, '[[|Sample plain')
      const linkList = titles(await until(() => suggestions().length && suggestions()))
      await enter()
      await enter()
      steps.push(await settle('${KEY}', [pond, '[[${PLAIN}]]']))
      // A note not written yet, typed out whole.
      await type(leaf, '[[|Not written yet]]')
      await enter()
      if (!same(stored('${KEY}'), [pond, '[[${PLAIN}]]', '[[Not written yet]]'])) await enter()
      steps.push(await settle('${KEY}', [pond, '[[${PLAIN}]]', '[[Not written yet]]']))
      document.activeElement?.blur?.()
      await wait(300)
      // The button: its list has the most used group first.
      cell(leaf, '${KEY}').querySelector('.abele-property-groups__pick').click()
      const items = await until(() => {
        const found = [...document.querySelectorAll('.prompt .suggestion-item')]
        return found.length && found
      })
      const offered = titles(items)
      const workshop = (items || []).find((i) => i.querySelector('.suggestion-title')?.textContent === '${GROUPS[1]}')
      if (!workshop) throw new Error('the workshop was not offered: ' + JSON.stringify(offered))
      workshop.click()
      steps.push(await settle('${KEY}', [pond, '[[${PLAIN}]]', '[[Not written yet]]', '[[${GROUPS[1]}]]']))
      const text = await raw()
      await wait(500)
      const pills = pills_(leaf)
      await shoot('desktop')
      // A pill is Obsidian's own link: a click opens its note.
      const link = [...cell(leaf, '${KEY}').querySelectorAll('.multi-select-pill-content')].find((p) => p.textContent === '${GROUPS[1]}')
      if (!link) throw new Error('no workshop pill')
      link.click()
      const opened = await until(() => {
        const f = app.workspace.getActiveFile()
        return f?.path === '${DIR}/${GROUPS[1]}.md' && f.path
      })
      return { linkList, offered, steps, text, pills, opened }
    `)
    expect(r.error).toBeUndefined()
    expect(r.linkList.join(' ')).toContain(PLAIN)
    expect(r.offered[0]).toBe(GROUPS[1])
    expect(r.offered).not.toContain(GROUPS[3])
    const pond = `[[${DIR}/${GROUPS[3]}|Pond]]`
    expect(r.steps).toEqual([
      [pond],
      [pond, `[[${PLAIN}]]`],
      [pond, `[[${PLAIN}]]`, '[[Not written yet]]'],
      [pond, `[[${PLAIN}]]`, '[[Not written yet]]', `[[${GROUPS[1]}]]`],
    ])
    // Stored the way Obsidian writes a list of links: one per line, quoted, the alias kept.
    expect(r.text).toContain(`  - "${pond}"`)
    expect(r.text).toContain(`  - "[[Not written yet]]"`)
    expect(r.text).toContain(`  - "[[${GROUPS[1]}]]"`)
    expect(r.pills).toEqual(['Pond', PLAIN, 'Not written yet', GROUPS[1]])
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

    it('wraps its pills inside the cell, the button beside them opening its list', () => {
      const r = run<{
        error?: string
        mobile: boolean
        rows: number
        overflow: number
        button: { inside: boolean; size: number }
        offered: (string | null)[]
        listInside: boolean
      }>(`
        const mobile = app.isMobile
        await until(() => app.workspace.layoutReady)
        await wait(1000)
        // Long names first, so the pills cannot fit on one line.
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
        await app.fileManager.processFrontMatter(file, (fm) => {
          fm['${KEY}'] = [${JSON.stringify(`[[${GROUPS[2]}]]`)}].concat(fm['${KEY}'] ?? [])
        })
        const leaf = await open()
        await until(() => cell(leaf, '${KEY}')?.querySelectorAll('.multi-select-pill').length >= 3)
        await wait(500)
        const c = cell(leaf, '${KEY}')
        const box = c.getBoundingClientRect()
        const pills = [...c.querySelectorAll('.multi-select-pill')].map((p) => p.getBoundingClientRect())
        const rows = new Set(pills.map((p) => Math.round(p.top))).size
        const overflow = Math.max(0, ...pills.map((p) => p.right - box.right))
        const b = c.querySelector('.abele-property-groups__pick')
        const br = b.getBoundingClientRect()
        const button = { inside: br.left >= box.left - 1 && br.right <= box.right + 1, size: Math.min(br.width, br.height) }
        b.click()
        const items = await until(() => {
          const found = [...document.querySelectorAll('.prompt .suggestion-item')]
          return found.length && found
        })
        const offered = titles(items)
        const list = document.querySelector('.prompt')?.getBoundingClientRect()
        const listInside = !!list && list.left >= 0 && list.right <= window.innerWidth + 1
        await shoot('phone')
        document.querySelector('.prompt-input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await until(() => !document.querySelector('.prompt'), 3000)
        if (document.querySelector('.prompt')) throw new Error('the list did not close on Escape')
        return { mobile, rows, overflow, button, offered, listInside }
      `)
      expect(r.error).toBeUndefined()
      expect(r.mobile).toBe(true)
      expect(r.rows).toBeGreaterThan(1)
      expect(r.overflow).toBeLessThanOrEqual(1)
      expect(r.button.inside).toBe(true)
      expect(r.button.size).toBeGreaterThanOrEqual(24)
      expect(r.offered[0]).toBe(GROUPS[0])
      expect(r.listInside).toBe(true)
    })
  })
})
