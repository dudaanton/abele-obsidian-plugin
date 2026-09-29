/**
 * Dates, priorities and labels in the running app: the names listed in the settings are drawn
 * with their own buttons, and each button writes the note's frontmatter — a date a day on or
 * back over a month's end, its daily note opened (made first), a priority raised and lowered,
 * a label typed, one picked from those another note uses, one taken off. On a phone
 * (`emulateMobile`) the rows fit their cells and their buttons are big enough to tap.
 *
 * Everything is written into a folder of its own and deleted after, with the settings put back.
 * Pictures go to `/tmp/abele-property-kinds/` — look at them.
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
const DIR = 'Property kinds e2e'
const NOTE = `${DIR}/Sample task.md`
const OTHER = `${DIR}/Other sample.md`
const DAILY = `${DIR}/Daily`
const DATE = 'pk-when'
const PRIO = 'pk-rank'
const LABELS = 'pk-tags'
const SHOTS = '/tmp/abele-property-kinds'

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
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  const press = async (leaf, key, selector) => {
    const b = await until(() => cell(leaf, key)?.querySelector(selector))
    if (!b) throw new Error('no ' + selector + ' in ' + key)
    b.click()
  }
  const settle = async (key, want) => (await until(() => same(stored(key), want), 8000)) ? want : stored(key) ?? null
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
  dates: string[]
  priorities: string[]
  labels: string[]
  journals: unknown[]
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

const FRONTMATTER = `---\\n${DATE}: 2026-01-31\\n${PRIO}:\\n${LABELS}:\\n---\\n\\nBody.\\n`

describe.skipIf(!available)('date, priority and labels properties', () => {
  let saved: Saved | null = null

  beforeAll(() => {
    // A pool window is never the one in front: without this, the field typed into is not the
    // page's active element to Obsidian, and the list of labels never opens.
    setFocusEmulation(true)
    saved = evalJson<Saved>(
      `(() => {
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        return {
          widgets: cfg.propertyWidgets,
          dates: [...(cfg.dateProperties ?? [])],
          priorities: [...(cfg.priorityProperties ?? [])],
          labels: [...(cfg.labelProperties ?? [])],
          journals: cfg.journals.map((j) => j.toDTO()),
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
        cfg.dateProperties = ['${DATE}']
        cfg.priorityProperties = ['${PRIO}']
        cfg.labelProperties = ['${LABELS}']
        const Journal = cfg.journals[0]?.constructor
        const dto = { id: 'pk-daily', name: 'Sample daily', type: 'pk-daily', isDefault: true, recurrence: 'daily', newPathTemplate: '${DAILY}/{{date}}' }
        if (Journal) cfg.journals = [new Journal(dto), ...cfg.journals.filter((j) => !(j.isDefault && j.recurrence === 'daily'))]
        await cfg.saveSettings()
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        await app.vault.create(${JSON.stringify(OTHER)}, '---\\n${LABELS}:\\n  - sample-beta\\n  - sample-gamma\\n---\\n')
        await app.vault.create(${JSON.stringify(NOTE)}, '${FRONTMATTER}')
        // The labels another note uses are offered once Obsidian has read that note.
        for (let i = 0; i < 100 && !app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(${JSON.stringify(OTHER)}))?.frontmatter; i++)
          await new Promise((r) => setTimeout(r, 100))
        await new Promise((r) => setTimeout(r, 1000))
        return Journal ? 'ok' : 'no journal class'
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
          cfg.dateProperties = saved.dates
          cfg.priorityProperties = saved.priorities
          cfg.labelProperties = saved.labels
          const Journal = cfg.journals[0]?.constructor
          if (Journal) cfg.journals = saved.journals.map((dto) => new Journal(dto))
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

  it('steps a date a day on and back over a month’s end, and opens its daily note', () => {
    const r = run<{
      error?: string
      drawn: boolean
      relative: string
      steps: unknown[]
      daily: string | null
    }>(`
      const leaf = await open()
      const drawn = !!(await until(() => cell(leaf, '${DATE}')?.querySelector('.abele-property-date')))
      const relative = cell(leaf, '${DATE}').querySelector('.abele-property-date__relative')?.textContent ?? ''
      const steps = [stored('${DATE}')]
      await press(leaf, '${DATE}', '.abele-property-date__later')
      steps.push(await settle('${DATE}', '2026-02-01'))
      await press(leaf, '${DATE}', '.abele-property-date__earlier')
      steps.push(await settle('${DATE}', '2026-01-31'))
      await press(leaf, '${DATE}', '.abele-property-date__earlier')
      steps.push(await settle('${DATE}', '2026-01-30'))
      await wait(300)
      await shoot('desktop')
      await press(leaf, '${DATE}', '.abele-property-date__daily')
      const daily = await until(() => {
        const f = app.workspace.getActiveFile()
        return f?.path === '${DAILY}/2026-01-30.md' && f.path
      })
      return { drawn, relative, steps, daily }
    `)
    expect(r.error).toBeUndefined()
    expect(r.drawn).toBe(true)
    expect(r.relative).toMatch(/days ago$/)
    expect(r.steps).toEqual(['2026-01-31', '2026-02-01', '2026-01-31', '2026-01-30'])
    expect(r.daily).toBe(`${DAILY}/2026-01-30.md`)
  })

  it('raises and lowers a priority on the task scale', () => {
    const r = run<{ error?: string; steps: unknown[]; name: string }>(`
      const leaf = await open()
      await until(() => cell(leaf, '${PRIO}')?.querySelector('.abele-property-priority'))
      const steps = [stored('${PRIO}') ?? null]
      await press(leaf, '${PRIO}', '.abele-property-priority__raise')
      steps.push(await settle('${PRIO}', 'low'))
      await press(leaf, '${PRIO}', '.abele-property-priority__raise')
      steps.push(await settle('${PRIO}', 'medium'))
      await press(leaf, '${PRIO}', '.abele-property-priority__lower')
      steps.push(await settle('${PRIO}', 'low'))
      await press(leaf, '${PRIO}', '.abele-property-priority__raise')
      steps.push(await settle('${PRIO}', 'medium'))
      await wait(200)
      const name = cell(leaf, '${PRIO}').querySelector('.abele-property-priority__name')?.textContent
      return { steps, name }
    `)
    expect(r.error).toBeUndefined()
    expect(r.steps).toEqual([null, 'low', 'medium', 'low', 'medium'])
    expect(r.name).toBe('Medium')
  })

  it('adds a typed label and one from the vault, and takes one off', () => {
    const r = run<{ error?: string; steps: unknown[]; offered: string[]; pills: string[] }>(`
      const leaf = await open()
      const field = () => cell(leaf, '${LABELS}')?.querySelector('.abele-property-labels__input')
      await until(field)
      const steps = [stored('${LABELS}') ?? null]
      // Typed as a keyboard types: the list follows the text, and Enter takes its first line,
      // here the text itself as a new label.
      field().focus()
      field().value = 'sample-alpha'
      field().dispatchEvent(new Event('input', { bubbles: true }))
      await until(() => document.querySelector('.suggestion-container .suggestion-item'))
      field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      steps.push(await settle('${LABELS}', ['sample-alpha']))
      await wait(300)
      const input = await until(field)
      input.value = 'sample-b'
      // Typed into again until the list is up: a window that is not in front can take the
      // focus late.
      const items = await until(() => {
        const found = [...document.querySelectorAll('.suggestion-container .suggestion-item')]
        if (found.some((i) => i.textContent === 'sample-beta')) return found
        input.blur()
        input.focus()
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return null
      })
      const offered = (items ?? []).map((i) => i.textContent)
      const beta = (items ?? []).find((i) => i.textContent === 'sample-beta')
      if (!beta) throw new Error('sample-beta was not offered: ' + JSON.stringify(offered))
      beta.click()
      steps.push(await settle('${LABELS}', ['sample-alpha', 'sample-beta']))
      await wait(300)
      await press(leaf, '${LABELS}', '.multi-select-pill[data-label="sample-alpha"] .multi-select-pill-remove-button')
      steps.push(await settle('${LABELS}', ['sample-beta']))
      await wait(300)
      const pills = [...cell(leaf, '${LABELS}').querySelectorAll('.multi-select-pill')].map((p) => p.dataset.label)
      await shoot('desktop-labels')
      return { steps, offered, pills }
    `)
    expect(r.error).toBeUndefined()
    expect(r.offered[0]).toBe('sample-beta')
    expect(r.steps).toEqual([
      null,
      ['sample-alpha'],
      ['sample-alpha', 'sample-beta'],
      ['sample-beta'],
    ])
    expect(r.pills).toEqual(['sample-beta'])
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

    it('is tapped the same way, fits its cells, with buttons a finger can hit', () => {
      const r = run<{
        error?: string
        mobile: boolean
        date: unknown
        priority: unknown
        labels: unknown
        sizes: number[]
        overflow: string[]
      }>(
        `
        const leaf = await open()
        await until(() => cell(leaf, '${DATE}')?.querySelector('.abele-property-date'))
        await until(() => cell(leaf, '${LABELS}')?.querySelector('.abele-property-labels'))
        const d0 = stored('${DATE}')
        await press(leaf, '${DATE}', '.abele-property-date__later')
        const date = await settle('${DATE}', '2026-01-31')
        await press(leaf, '${PRIO}', '.abele-property-priority__raise')
        const priority = await settle('${PRIO}', 'high')
        await press(leaf, '${LABELS}', '.multi-select-pill-remove-button')
        const labels = await settle('${LABELS}', null)
        await wait(300)
        const sizes = [...leaf.view.containerEl.querySelectorAll('.abele-property-date button, .abele-property-priority button')].map((b) => {
          const box = b.getBoundingClientRect()
          return Math.min(box.width, box.height)
        })
        const overflow = ['${DATE}', '${PRIO}', '${LABELS}'].filter((key) => {
          const c = cell(leaf, key)
          const row = c.firstElementChild
          return row.getBoundingClientRect().right > c.getBoundingClientRect().right + 1
        })
        await shoot('phone')
        return { mobile: app.isMobile, d0, date, priority, labels, sizes, overflow }
      `,
        90_000
      )
      expect(r.error).toBeUndefined()
      expect(r.mobile).toBe(true)
      expect(r.date).toBe('2026-01-31')
      expect(r.priority).toBe('high')
      expect(r.labels).toBeNull()
      expect(r.sizes).toHaveLength(5)
      for (const size of r.sizes) expect(size).toBeGreaterThanOrEqual(24)
      expect(r.overflow).toEqual([])
    })
  })
})
