/**
 * The linter in the running app: a folder of notes written for the run, linted into the linter's
 * tab; a line pressed opens its note at that line beside the tab; Fix all, after its question,
 * rewrites what the rules can fix and leaves the rest listed; a rule written as a script finds
 * what it is meant to. Then the same tab on a phone (390×844 under `emulateMobile`): nothing past
 * the screen's edge, and pictures of the list and of a fix's preview in `/tmp/abele-phone/`.
 *
 * The notes, the script and the linter settings are put back afterwards: the fixture vault holds
 * ScaleTest/ and nothing else. Requires Obsidian running with the development build — see
 * docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'

const available = isObsidianRunning() && hasTestApi()

const FOLDER = 'E2E Lint'
const SCRIPT_NAME = 'E2E lint todo'
const SCRIPT = `// @name ${SCRIPT_NAME}
// @description No TODO left in a note
// @lint warning
function check(note) {
  return note.lines.flatMap((text, i) => (text.includes('TODO') ? [{ message: 'A TODO is left', line: i + 1 }] : []))
}
`
const NOTES: Record<string, string> = {
  'Bare.md': '# Bare\nText\n',
  'Heading.md': '---\ncreated: 2026-01-01\n---\n# Chapter\nText\n',
  'Slipped.md': '\n---\ncreated: 2026-01-01\n---\n\nText\n',
  'Good.md': '---\ncreated: 2026-01-01\n---\n\nText\n',
  'Todo.md': '---\ncreated: 2026-01-01\n---\n\nTODO later\n',
}
const SHOTS = '/tmp/abele-phone'
const PHONE = { width: 390, height: 844 }

/** Runs an async probe in the app and parses what it answers. */
function probe<T>(body: string, timeoutMs = 60_000): T {
  const raw = evalRaw(
    `(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const until = async (fn, ms) => {
        const deadline = Date.now() + ms
        while (Date.now() < deadline) {
          if (await fn()) return true
          await wait(100)
        }
        return false
      }
      const t = window.__abeleTest
      try {
        return JSON.stringify({ ok: true, value: await (async () => { ${body} })() })
      } catch (e) {
        return JSON.stringify({ ok: false, error: String((e && e.stack) || e) })
      }
    })()`,
    timeoutMs
  )
  let parsed: { ok: boolean; value?: T; error?: string }
  try {
    parsed = JSON.parse(
      raw
        .trim()
        .replace(/^'(.*)'$/s, '$1')
        .replace(/^"(.*)"$/s, '$1')
    )
  } catch {
    throw new Error(`The probe answered with something other than JSON: ${raw.slice(0, 400)}`)
  }
  if (!parsed.ok) throw new Error(`Probe failed in the app: ${parsed.error}`)
  return parsed.value as T
}

const setup = `
  const config = t.AbeleConfig.getInstance()
  window.__lintSaved = JSON.stringify(config.linter)
  config.linter = { exclude: [], rules: {} }
  if (!app.vault.getAbstractFileByPath('${FOLDER}')) await app.vault.createFolder('${FOLDER}')
  const notes = ${JSON.stringify(NOTES)}
  for (const [name, text] of Object.entries(notes)) {
    const path = '${FOLDER}/' + name
    const old = app.vault.getAbstractFileByPath(path)
    if (old) await app.vault.delete(old)
    await app.vault.create(path, text)
  }
  const folder = config.ai.scriptsFolder || 'Scripts'
  if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder)
  const path = folder + '/${SCRIPT_NAME}.js'
  const old = app.vault.getAbstractFileByPath(path)
  if (old) await app.vault.delete(old)
  await app.vault.create(path, ${JSON.stringify(SCRIPT)})
  await t.ScriptService.getInstance().discover()
  await until(() => Object.keys(notes).every((n) => app.metadataCache.getFileCache(app.vault.getAbstractFileByPath('${FOLDER}/' + n))), 5000)
  return true
`

const cleanup = `
  const config = t.AbeleConfig.getInstance()
  if (window.__lintSaved) config.linter = JSON.parse(window.__lintSaved)
  for (const m of document.querySelectorAll('.modal-close-button')) m.click()
  app.workspace.detachLeavesOfType('abele-linter')
  const dir = app.vault.getAbstractFileByPath('${FOLDER}')
  if (dir) await app.vault.delete(dir, true)
  const folder = config.ai.scriptsFolder || 'Scripts'
  const f = app.vault.getAbstractFileByPath(folder + '/${SCRIPT_NAME}.js')
  if (f) await app.vault.delete(f)
  const scripts = app.vault.getAbstractFileByPath(folder)
  if (scripts && scripts.children && scripts.children.length === 0) await app.vault.delete(scripts, true)
  await t.ScriptService.getInstance().discover()
  return true
`

/** Lints the folder into the tab and waits for the tab to draw what was found. */
const lintFolder = `
  await t.lintInView(app, { kind: 'folder', path: '${FOLDER}' })
  const view = () => app.workspace.getLeavesOfType('abele-linter')[0]?.view.containerEl
  await until(() => view()?.querySelector('.abele-linter__group'), 5000)
  const el = view()
  const report = t.LinterService.getInstance().report.value
  return {
    headline: el.querySelector('[data-testid="linter-headline"]').textContent.trim(),
    groups: [...el.querySelectorAll('.abele-linter__group')].map((g) => g.dataset.group),
    issues: report.issues.map((i) => i.path.replace('${FOLDER}/', '') + ':' + i.rule + ':' + i.line),
    ruleErrors: report.ruleErrors,
  }
`

interface Linted {
  headline: string
  groups: string[]
  issues: string[]
  ruleErrors: Record<string, string>
}

describe.skipIf(!available)('the linter', () => {
  beforeAll(() => {
    probe(setup)
  }, 60_000)

  afterAll(() => {
    probe(cleanup)
  }, 60_000)

  it('lints a folder into its tab, a script rule among the rules', () => {
    const r = probe<Linted>(lintFolder)
    expect(r.ruleErrors).toEqual({})
    expect(r.groups).toEqual([
      `${FOLDER}/Bare.md`,
      `${FOLDER}/Heading.md`,
      `${FOLDER}/Slipped.md`,
      `${FOLDER}/Todo.md`,
    ])
    expect(r.issues).toEqual(
      expect.arrayContaining([
        'Bare.md:frontmatter-present:1',
        'Bare.md:required-properties:1',
        'Bare.md:no-h1:1',
        'Heading.md:blank-line-after-frontmatter:4',
        'Heading.md:no-h1:4',
        'Slipped.md:frontmatter-valid:2',
        `Todo.md:script:${SCRIPT_NAME}:5`,
      ])
    )
    expect(r.headline).toMatch(/Linted the folder E2E Lint: 5 notes\. \d+ issues in 4 notes/)
  }, 60_000)

  it('opens the note at the line pressed, beside the linter', () => {
    const r = probe<{ file: string; line: number; linterOpen: boolean }>(`
      const el = app.workspace.getLeavesOfType('abele-linter')[0].view.containerEl
      const row = el.querySelector('.abele-linter__issue[data-path="${FOLDER}/Heading.md"][data-rule="no-h1"]')
      if (!row) throw new Error('no row for the heading')
      row.click()
      await until(() => app.workspace.getActiveFile()?.path === '${FOLDER}/Heading.md', 5000)
      await wait(300)
      const editor = app.workspace.activeEditor?.editor
      return {
        file: app.workspace.getActiveFile()?.path,
        line: editor ? editor.getCursor('from').line + 1 : -1,
        linterOpen: app.workspace.getLeavesOfType('abele-linter').length === 1,
      }
    `)
    expect(r.file).toBe(`${FOLDER}/Heading.md`)
    expect(r.line).toBe(4)
    expect(r.linterOpen).toBe(true)
  }, 60_000)

  it('fixes all it can after asking, and leaves the rest listed', () => {
    const r = probe<{ asked: string; texts: Record<string, string>; left: string[] }>(`
      const leaf = app.workspace.getLeavesOfType('abele-linter')[0]
      app.workspace.revealLeaf(leaf)
      const el = leaf.view.containerEl
      const button = [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Fix all')
      button.click()
      await until(() => [...document.querySelectorAll('.modal button')].some((b) => b.textContent.trim() === 'Fix'), 3000)
      const asked = document.querySelector('.modal .modal-content')?.textContent ?? ''
      ;[...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Fix').click()
      const service = t.LinterService.getInstance()
      await until(() => !service.fixing.value && service.report.value.issues.every((i) => !i.fixable), 10000)
      const texts = {}
      for (const name of ['Bare.md', 'Heading.md', 'Slipped.md', 'Good.md', 'Todo.md']) {
        texts[name] = await app.vault.read(app.vault.getAbstractFileByPath('${FOLDER}/' + name))
      }
      await wait(300)
      return {
        asked,
        texts,
        left: [...el.querySelectorAll('.abele-linter__issue')].map((i) => i.dataset.path.replace('${FOLDER}/', '') + ':' + i.dataset.rule),
      }
    `)
    expect(r.asked).toMatch(/Fix \d+ issues in 3 notes\?/)
    expect(r.texts['Bare.md']).toMatch(/^---\ncreated: \d{4}-\d{2}-\d{2}\n---\n\nText\n$/)
    expect(r.texts['Heading.md']).toBe('---\ncreated: 2026-01-01\n---\n\n## Chapter\nText\n')
    expect(r.texts['Slipped.md']).toBe('---\ncreated: 2026-01-01\n---\n\nText\n')
    expect(r.texts['Good.md']).toBe(NOTES['Good.md'])
    expect(r.texts['Todo.md']).toBe(NOTES['Todo.md'])
    expect(r.left).toEqual([`Todo.md:script:${SCRIPT_NAME}`])
  }, 60_000)

  /** Starts a run of the fixture's thousands of notes, sampling how long the page goes unserviced. */
  const startBig = (cancelAfterMs: number) =>
    evalRaw(`(() => {
      const s = window.__abeleTest.LinterService.getInstance()
      window.__lintBig = null
      let worst = 0
      let last = performance.now()
      const tick = setInterval(() => {
        const now = performance.now()
        worst = Math.max(worst, now - last)
        last = now
      }, 16)
      const started = performance.now()
      if (${cancelAfterMs} > 0) setTimeout(() => s.cancel(), ${cancelAfterMs})
      s.run({ kind: 'folder', path: 'ScaleTest' }).then(
        (r) => {
          clearInterval(tick)
          window.__lintBig = { ms: Math.round(performance.now() - started), checked: r.checked, total: r.total, issues: r.issues.length, cancelled: r.cancelled, worst: Math.round(worst) }
        },
        (e) => {
          clearInterval(tick)
          window.__lintBig = { error: String(e) }
        }
      )
      return 'started'
    })()`)

  interface Big {
    ms: number
    checked: number
    total: number
    issues: number
    cancelled: boolean
    worst: number
    error?: string
  }

  const waitBig = async (seconds: number): Promise<Big> => {
    for (let i = 0; i < seconds; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const got = evalJson<Big | null>('window.__lintBig ?? null')
      if (got) {
        if (got.error) throw new Error(got.error)
        return got
      }
    }
    throw new Error('the run did not finish')
  }

  it('goes through the fixture’s thousands of notes without freezing the app', async () => {
    startBig(0)
    const r = await waitBig(240)
    console.info(
      `\n  linted ${r.checked} notes in ${r.ms} ms, ${r.issues} issues, longest stall ${r.worst} ms\n`
    )
    expect(r.total).toBeGreaterThan(1000)
    expect(r.checked).toBe(r.total)
    expect(r.cancelled).toBe(false)
    expect(r.worst).toBeLessThan(750)
  }, 300_000)

  it('stops part way when asked, keeping what it found', async () => {
    startBig(300)
    const r = await waitBig(60)
    expect(r.cancelled).toBe(true)
    expect(r.checked).toBeGreaterThan(0)
    expect(r.checked).toBeLessThan(r.total)
  }, 120_000)

  describe('on a phone', () => {
    let size: [number, number] = [0, 0]

    beforeAll(async () => {
      size = evalJson<[number, number]>(
        `require('@electron/remote').getCurrentWindow().getContentSize()`
      )
      evalRaw(
        `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${PHONE.width}, ${PHONE.height}); return 'ok' })()`
      )
      await reloadApp('app.emulateMobile(true)')
      // Something to list again, and a note with a fix to preview.
      probe(`
        const f = app.vault.getAbstractFileByPath('${FOLDER}/Heading.md')
        await app.vault.modify(f, ${JSON.stringify(NOTES['Heading.md'])})
        return true
      `)
    }, 180_000)

    afterAll(async () => {
      if (size[0]) {
        evalRaw(
          `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]}); return 'ok' })()`
        )
      }
      await reloadApp('app.emulateMobile(false)')
    }, 180_000)

    it('keeps the list and a fix’s preview inside the screen', () => {
      const r = probe<{
        over: string[]
        previewOver: string[]
        shots: string[]
        groups: number
        diff: boolean
      }>(
        `
        const fs = require('fs')
        const win = require('@electron/remote').getCurrentWindow()
        fs.mkdirSync('${SHOTS}', { recursive: true })
        const shoot = async (name) => {
          const path = '${SHOTS}/linter-' + name + '.png'
          try { fs.writeFileSync(path, (await win.webContents.capturePage()).toPNG()); return path } catch (e) { return 'no picture: ' + e }
        }
        const pastEdge = (root) => {
          const edge = Math.min(root.getBoundingClientRect().right, window.innerWidth)
          const out = []
          for (const el of root.querySelectorAll('*')) {
            const s = getComputedStyle(el)
            if (s.display === 'none' || s.visibility === 'hidden' || s.position === 'absolute') continue
            if (el.closest('.cm-editor')) continue
            const r = el.getBoundingClientRect()
            if (r.width > 0 && r.right > edge + 1) out.push(((el.className || el.tagName) + '').split(' ')[0] + ' +' + Math.round(r.right - edge))
          }
          return out
        }
        ${lintFolder.replace(/return \{[\s\S]*$/, '')}
        await wait(500)
        const root = app.workspace.getLeavesOfType('abele-linter')[0].view.containerEl
        const over = pastEdge(root)
        const shots = [await shoot('list')]
        const group = root.querySelector('.abele-linter__group[data-group="${FOLDER}/Heading.md"]')
        const icons = group.querySelectorAll('.abele-linter__group-actions > *')
        icons[1].click()
        await until(() => document.querySelector('.modal .abele-diff .cm-mergeView'), 5000)
        await wait(600)
        const modal = document.querySelector('.modal')
        const previewOver = pastEdge(modal)
        shots.push(await shoot('preview'))
        const diff = !!modal.querySelector('.abele-diff')
        document.querySelector('.modal-close-button')?.click()
        return { over, previewOver, shots, groups: root.querySelectorAll('.abele-linter__group').length, diff }
      `,
        120_000
      )
      console.info(`\n  linter on a phone: ${r.shots.join(', ')}\n`)
      expect(r.groups).toBeGreaterThan(0)
      expect(r.over).toEqual([])
      expect(r.diff).toBe(true)
      expect(r.previewOver).toEqual([])
    }, 180_000)
  })
})
