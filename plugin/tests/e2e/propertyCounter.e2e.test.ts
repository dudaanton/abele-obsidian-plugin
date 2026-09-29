/**
 * A counter property in the running app: a name listed in the settings is drawn with − and +,
 * and + on an empty property writes 1 into the note's frontmatter, then counts on from there.
 * On a phone (`emulateMobile`) the buttons are tapped the same way and are big enough to tap.
 *
 * Everything is written into a folder of its own and deleted after, with the settings put back.
 * Pictures go to `/tmp/abele-counter/` — look at them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson, reloadApp } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { onPhone } from './helpers/target'
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi() && !onPhone()
const PHONE = { width: 390, height: 844 }
const DIR = 'Property counter e2e'
const NOTE = `${DIR}/Workout.md`
const KEY = 'pw-count'
const SHOTS = shotDir('abele-counter')

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => {
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
  const cell = (leaf) => leaf.view.containerEl.querySelector('.metadata-property[data-property-key="${KEY}"] .metadata-property-value')
  const stored = () => app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))?.frontmatter?.['${KEY}']
  const text = () => app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))
  const press = async (leaf, name) => {
    const b = await until(() => cell(leaf)?.querySelector('.abele-property-counter__' + name))
    if (!b) throw new Error('no ' + name + ' button')
    b.click()
  }
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
  counters: string[]
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

describe.skipIf(!available)('a counter property', () => {
  let saved: Saved | null = null

  beforeAll(() => {
    saved = evalJson<Saved>(
      `(() => {
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        return { widgets: cfg.propertyWidgets, counters: [...(cfg.counterProperties ?? [])], shown: app.vault.getConfig('propertiesInDocument') ?? null }
      })()`,
      30_000
    )
    evalRaw(
      `(async () => {
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        app.vault.setConfig('propertiesInDocument', 'visible')
        cfg.propertyWidgets = true
        cfg.counterProperties = ['${KEY}']
        await cfg.saveSettings()
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        await app.vault.create(${JSON.stringify(NOTE)}, '---\\n${KEY}:\\n---\\n\\nBody.\\n')
        await new Promise((r) => setTimeout(r, 1000))
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
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        const saved = ${JSON.stringify(saved ?? { widgets: true, counters: [], shown: null })}
        cfg.propertyWidgets = saved.widgets
        cfg.counterProperties = saved.counters
        if (saved.shown) app.vault.setConfig('propertiesInDocument', saved.shown)
        await cfg.saveSettings()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  it('+ on an empty property writes 1, and − and + count from there', () => {
    const r = run<{ error?: string; drawn: boolean; steps: unknown[]; file: string }>(`
      const leaf = await open()
      const drawn = !!(await until(() => cell(leaf)?.querySelector('.abele-property-counter')))
      const steps = [stored() ?? null]
      await press(leaf, 'increase')
      steps.push(await until(() => stored() === 1 && 1))
      await press(leaf, 'increase')
      steps.push(await until(() => stored() === 2 && 2))
      await press(leaf, 'decrease')
      steps.push(await until(() => stored() === 1 && 1))
      await wait(300)
      await shoot('desktop')
      return { drawn, steps, file: await text() }
    `)
    expect(r.error).toBeUndefined()
    expect(r.drawn).toBe(true)
    expect(r.steps).toEqual([null, 1, 2, 1])
    expect(r.file).toContain(`${KEY}: 1`)
  })

  it('takes the buttons away and gives them back as the list in the settings changes', () => {
    const r = run<{ error?: string; off: boolean; on: boolean }>(`
      const cfg = window.__abeleTest.AbeleConfig.getInstance()
      const leaf = await open()
      await until(() => cell(leaf)?.querySelector('.abele-property-counter'))
      cfg.counterProperties = []
      await cfg.saveSettings()
      const off = !!(await until(() => cell(leaf) && !cell(leaf).querySelector('.abele-property-counter')))
      cfg.counterProperties = ['${KEY}']
      await cfg.saveSettings()
      const on = !!(await until(() => cell(leaf)?.querySelector('.abele-property-counter')))
      return { off, on }
    `)
    expect(r.error).toBeUndefined()
    expect(r.off).toBe(true)
    expect(r.on).toBe(true)
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

    it('is tapped the same way, with buttons a finger can hit', () => {
      const r = run<{
        error?: string
        mobile: boolean
        value: unknown
        sizes: number[]
        placeholder: { need: number; room: number }
      }>(
        `
        const leaf = await open()
        await until(() => cell(leaf)?.querySelector('.abele-property-counter'))
        const before = stored()
        await press(leaf, 'increase')
        const value = await until(() => stored() === before + 1 && stored())
        const sizes = [...cell(leaf).querySelectorAll('.abele-property-counter button')].map((b) => {
          const box = b.getBoundingClientRect()
          return Math.min(box.width, box.height)
        })
        // Emptied, the field shows its placeholder whole, not cut off at its edge.
        const field = cell(leaf).querySelector('.abele-property-counter__value')
        const kept = field.value
        field.value = ''
        const style = getComputedStyle(field)
        const ctx2d = document.createElement('canvas').getContext('2d')
        ctx2d.font = style.font
        const room = field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        const placeholder = { need: ctx2d.measureText(field.placeholder).width, room }
        field.value = kept
        await wait(300)
        await shoot('phone')
        return { mobile: app.isMobile, value, sizes, placeholder }
      `,
        90_000
      )
      expect(r.error).toBeUndefined()
      expect(r.mobile).toBe(true)
      expect(r.value).toBe(2)
      expect(r.sizes).toHaveLength(2)
      for (const size of r.sizes) expect(size).toBeGreaterThanOrEqual(24)
      // A pixel of rounding either way is not a cut-off letter.
      expect(r.placeholder.room).toBeGreaterThanOrEqual(r.placeholder.need - 1)
    })
  })
})
