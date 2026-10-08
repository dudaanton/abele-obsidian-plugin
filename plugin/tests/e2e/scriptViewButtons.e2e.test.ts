/**
 * Buttons in a script view look like Obsidian's own, in both themes and after the pointer
 * has been over them.
 *
 * The icon in a labelled button was the plugin's icon widget, which paints itself in the icon grey
 * and lights up a box of its own under the pointer — dark on the accent button, and a patch
 * inside every button on hover. Each button here is measured against a native `button` of the
 * same kind put beside it in the same row, and its icon against its own text, idle, hovered
 * through the real input pipeline, and after the pointer has left.
 *
 * Requires Obsidian running with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  isObsidianRunning,
  hasTestApi,
  evalJson,
  evalRaw,
  runCli,
  reloadApp,
} from './helpers/obsidianCli'

import { SCRIPT_FIXTURE, type ScriptFixtureSnapshot } from './helpers/scriptFixture'

const FOLDER = 'Sample button scripts'
const SCRIPT = `// @name E2E Buttons
// @description Buttons with icons, for the look test
const v = view({ title: 'E2E Buttons', icon: 'sun' })
v.body = [new Row([
  new Button({ text: 'Today', icon: 'sun', accent: true, cls: 'e2e-cta' }),
  new Button({ text: 'Add', icon: 'plus', cls: 'e2e-plain' }),
  new Icon({ icon: 'rotate-cw', tooltip: 'Refresh', cls: 'e2e-icon' }),
])]
await v.open()
`

type Probe<T> = { ok: true; value: T } | { ok: false; error: string }

async function probe<T>(body: string): Promise<T> {
  const started = evalRaw(`(() => {
    const t = window.__abeleTest
    ${SCRIPT_FIXTURE}
    t.viewProbe = null
    ;(async () => {
      try {
        t.viewProbe = { ok: true, value: await (async () => { ${body} })() }
      } catch (e) {
        t.viewProbe = { ok: false, error: String(e && e.stack || e) }
      }
    })()
    return 'started'
  })()`)
  if (!started.includes('started')) throw new Error(`Probe did not start: ${started}`)
  let result: Probe<T> | null = null
  for (let attempt = 0; attempt < 60 && !result; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    result = evalJson<Probe<T> | null>('window.__abeleTest.viewProbe ?? null')
  }
  if (!result) throw new Error('Probe did not finish in time')
  if (!result.ok) throw new Error(`Probe failed in the app: ${result.error}`)
  return result.value
}

const setup = `
  const t = window.__abeleTest
  const folder = ${JSON.stringify(FOLDER)}
  const path = folder + '/E2E Buttons.js'
  if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder)
  const existing = app.vault.getAbstractFileByPath(path)
  if (existing) await app.vault.delete(existing)
  await app.vault.create(path, ${JSON.stringify(SCRIPT)})
  await enableScriptFixture(folder)
  await approveScriptFixture(path, ${JSON.stringify(SCRIPT)})
  const s = t.ScriptService.getInstance().getAll().find((x) => x.meta.name === 'E2E Buttons')
  if (!s) throw new Error('E2E Buttons was not discovered')
  await t.ScriptService.getInstance().execute(s.path, {}, { source: 'command' })
  let root = null
  for (let i = 0; i < 100 && !root; i++) {
    root = document.querySelector('.abele-script-view_live .e2e-cta')?.closest('.abele-script-view')
    if (!root) await new Promise((r) => setTimeout(r, 100))
  }
  if (!root) throw new Error('the view did not open')
  // Natives of each kind, in the same row, so they inherit exactly what ours do.
  const row = root.querySelector('.e2e-cta').parentElement
  const cta = row.ownerDocument.createElement('button')
  cta.className = 'mod-cta e2e-native-cta'
  cta.textContent = 'Today'
  const plain = row.ownerDocument.createElement('button')
  plain.className = 'e2e-native-plain'
  plain.textContent = 'Add'
  const icon = row.ownerDocument.createElement('div')
  icon.className = 'clickable-icon e2e-native-icon'
  // The same glyph ours drew, so only the element around it differs.
  icon.innerHTML = root.querySelector('.e2e-icon svg').outerHTML
  row.append(cta, plain, icon)
  return true
`

/** What the eye sees of one element: its paint, and its icon's colour. */
const measure = `
  const root = document.querySelector('.abele-script-view_live')
  const look = (sel) => {
    const el = root.querySelector(sel)
    const cs = getComputedStyle(el)
    const svg = el.querySelector('svg')
    // Every box between the button and its svg must paint nothing of its own.
    const patches = []
    for (let n = svg?.parentElement; n && n !== el; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') patches.push(bg)
    }
    return {
      background: cs.backgroundColor,
      color: cs.color,
      border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
      shadow: cs.boxShadow,
      iconColor: svg ? getComputedStyle(svg).color : null,
      patches,
    }
  }
  return {
    cta: look('.e2e-cta'), nativeCta: look('.e2e-native-cta'),
    plain: look('.e2e-plain'), nativePlain: look('.e2e-native-plain'),
    icon: look('.e2e-icon'), nativeIcon: look('.e2e-native-icon'),
  }
`
type Look = {
  background: string
  color: string
  border: string
  shadow: string
  iconColor: string | null
  patches: string[]
}
type Looks = Record<'cta' | 'nativeCta' | 'plain' | 'nativePlain' | 'icon' | 'nativeIcon', Look>

const centreOf = (sel: string) =>
  evalJson<{ x: number; y: number }>(`(() => {
    const r = document.querySelector('.abele-script-view_live ${sel}').getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)

/** The svg's own box, so the pointer is over the icon — where the old patch lit up. */
const iconOf = (sel: string) =>
  evalJson<{ x: number; y: number }>(`(() => {
    const r = document.querySelector('.abele-script-view_live ${sel} svg').getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)

const moveTo = (p: { x: number; y: number }) =>
  runCli(
    [
      'dev:cdp',
      'method=Input.dispatchMouseEvent',
      `params=${JSON.stringify({ type: 'mouseMoved', x: p.x, y: p.y, button: 'none' })}`,
    ],
    30_000
  )

/** A point inside the view but below the row, where nothing reacts to the pointer. */
const away = () =>
  evalJson<{ x: number; y: number }>(`(() => {
    const r = document.querySelector('.abele-script-view_live').getBoundingClientRect()
    return { x: Math.round(r.left + 8), y: Math.round(r.bottom - 8) }
  })()`)

const settle = () => new Promise((r) => setTimeout(r, 250))
/** Long enough for Obsidian's own tap feedback to have come and gone. */
const lingering = () => new Promise((r) => setTimeout(r, 1500))

const paint = (l: Look) => ({ background: l.background, color: l.color, border: l.border })

function expectNative(looks: Looks, when: string): void {
  expect(looks.cta.iconColor, `${when}: cta icon follows its text`).toBe(looks.cta.color)
  expect(looks.plain.iconColor, `${when}: button icon follows its text`).toBe(looks.plain.color)
  expect(looks.cta.patches, `${when}: nothing painted around the cta icon`).toEqual([])
  expect(looks.plain.patches, `${when}: nothing painted around the button icon`).toEqual([])
  expect(paint(looks.cta), `${when}: cta as native`).toEqual(paint(looks.nativeCta))
  expect(paint(looks.plain), `${when}: button as native`).toEqual(paint(looks.nativePlain))
  expect(paint(looks.icon), `${when}: icon as native`).toEqual(paint(looks.nativeIcon))
}

let originalDark = false

// Once on the desktop and once in a phone's layout, where Obsidian styles its buttons for touch.
for (const phone of [false, true])
  describe(`buttons in a script view ${phone ? 'as a phone' : 'on the desktop'}`, () => {
    let fixture: ScriptFixtureSnapshot | undefined
    beforeAll(async () => {
      if (!isObsidianRunning() || !hasTestApi()) {
        throw new Error('Obsidian with the development build is not running')
      }
      if (phone) await reloadApp('app.emulateMobile(true)')
      originalDark = evalJson<boolean>(`document.body.classList.contains('theme-dark')`)
      fixture = await probe<ScriptFixtureSnapshot>('return await saveScriptFixture()')
      await probe(setup)
    }, 180_000)

    afterAll(async () => {
      evalRaw(`(() => {
      document.body.classList.toggle('theme-dark', ${originalDark})
      document.body.classList.toggle('theme-light', ${!originalDark})
      return true
    })()`)
      try {
        await probe(`
      for (const leaf of app.workspace.getLeavesOfType('abele-script-view')) leaf.detach()
      const folder = ${JSON.stringify(FOLDER)}
      const f = app.vault.getAbstractFileByPath(folder + '/E2E Buttons.js')
      if (f) await app.vault.delete(f)
      const dir = app.vault.getAbstractFileByPath(folder)
      if (dir && dir.children && dir.children.length === 0) await app.vault.delete(dir, true)
      window.__abeleTest.viewProbe = null
      return true
    `)
      } finally {
        await probe(`await restoreScriptFixture(${JSON.stringify(fixture)}); return true`)
        if (phone) await reloadApp('app.emulateMobile(false)')
      }
    }, 180_000)

    for (const dark of [false, true]) {
      const theme = dark ? 'dark' : 'light'

      it(`look native in the ${theme} theme, idle, hovered and after the pointer leaves`, async () => {
        evalRaw(`(() => {
        document.body.classList.toggle('theme-dark', ${dark})
        document.body.classList.toggle('theme-light', ${!dark})
        return true
      })()`)
        moveTo(away())
        await settle()
        expectNative(await probe<Looks>(measure), `${theme} idle`)

        // Hovered: the native of each kind first, then ours with the pointer on its icon.
        const hovered: Partial<Looks> = {}
        for (const [ours, native] of [
          ['cta', 'nativeCta'],
          ['plain', 'nativePlain'],
          ['icon', 'nativeIcon'],
        ] as const) {
          moveTo(centreOf(`.e2e-native-${ours}`))
          await settle()
          hovered[native] = (await probe<Looks>(measure))[native]
          moveTo(iconOf(`.e2e-${ours}`))
          await settle()
          hovered[ours] = (await probe<Looks>(measure))[ours]
        }
        // The pointer really was there: a native icon under it lights up.
        expect(hovered.nativeIcon?.background, 'the hover reached the page').not.toBe(
          'rgba(0, 0, 0, 0)'
        )
        expectNative(hovered as Looks, `${theme} hovered`)

        moveTo(away())
        await settle()
        expectNative(await probe<Looks>(measure), `${theme} after hover-out`)
      }, 90_000)
    }

    it('keep no hover look after a tap on a touch screen', async () => {
      // A phone has no pointer to hover with, yet a tap leaves `:hover` on what was tapped. Touch
      // emulation makes this window such a screen — `(hover: none)`, as a phone reports — and
      // the taps go through the page's own input pipeline.
      const cdp = (method: string, params: object) =>
        runCli(['dev:cdp', `method=${method}`, `params=${JSON.stringify(params)}`], 30_000)
      const tap = (p: { x: number; y: number }) => {
        cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] })
        cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      }
      moveTo(away())
      cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
      try {
        expect(evalJson<boolean>(`matchMedia('(hover: none)').matches`)).toBe(true)
        await settle()
        const idle = await probe<Looks>(measure)
        for (const [ours, native] of [
          ['cta', 'nativeCta'],
          ['plain', 'nativePlain'],
          ['icon', 'nativeIcon'],
        ] as const) {
          // The native of the same kind is tapped the same way first, so whatever feedback
          // Obsidian itself gives a tap is what ours is held to, and nothing more.
          tap(centreOf(`.e2e-native-${ours}`))
          await lingering()
          const nativeTapped = (await probe<Looks>(measure))[native]
          tap(iconOf(`.e2e-${ours}`))
          await lingering()
          const tapped = (await probe<Looks>(measure))[ours]
          expect(paint(tapped), `${ours} after a tap`).toEqual(paint(nativeTapped))
          expect(paint(tapped), `${ours} after a tap, as idle`).toEqual(paint(idle[ours]))
        }
      } finally {
        cdp('Emulation.setTouchEmulationEnabled', { enabled: false })
        moveTo(away())
      }
    }, 60_000)
  })
