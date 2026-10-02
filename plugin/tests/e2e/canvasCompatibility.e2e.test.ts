import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import {
  evalJson,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  runCli,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'

// A spike against the host's own Canvas, not an implementation of a diagram editor.
targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const mobile = process.env.CANVAS_PROBE_MOBILE === '1'
const output = resolve('build/canvas-stage0', onPhone() ? 'phone' : mobile ? 'emulated' : 'desktop')
const results: Record<string, unknown> = {}
function record<T>(method: string, result: T): T {
  results[method] = result
  mkdirSync(output, { recursive: true })
  writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2))
  return result
}
const probe = <T>(method: string): T =>
  record(method, evalAsync<T>(`window.__abeleTest.canvasProbe.${method}()`, 120_000))
interface Data {
  nodes: { id: string }[]
  [key: string]: unknown
}
interface Moved {
  before: Data
  after: Data
  moved: boolean
}
const byId = (data: Data) => ({
  ...data,
  nodes: Object.fromEntries(data.nodes.map((n) => [n.id, n])),
})
const shoot = (name: string) => {
  if (onPhone()) return
  evalAsync(`(async () => {
    const img = await require('@electron/remote').getCurrentWebContents().capturePage()
    require('fs').writeFileSync(${JSON.stringify(`${output}/`)} + ${JSON.stringify(name)} + '.png', img.toPNG())
    return true
  })()`)
}

describe.skipIf(!available)('native Canvas compatibility', () => {
  let size: number[] | null = null
  beforeAll(async () => {
    if (mobile && !onPhone()) {
      size = evalJson<number[]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)
      evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
      await reloadApp('app.emulateMobile(true)')
    }
    evalRaw(`window.__canvasProbePreference = window.__abeleTest.AbeleConfig.getInstance().canvasViewer; window.__abeleTest.AbeleConfig.getInstance().canvasViewer = false`)
    probe('setup')
  }, 120_000)
  afterAll(async () => {
    probe('cleanup')
    evalRaw(`if (window.__canvasProbePreference !== undefined) window.__abeleTest.AbeleConfig.getInstance().canvasViewer = window.__canvasProbePreference; delete window.__canvasProbePreference`)
    if (size) {
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`
      )
      await reloadApp('app.emulateMobile(false)')
    }
  }, 120_000)

  it('keeps all extension values by id after a native node move and save', () => {
    let r: Moved
    if (onPhone() || mobile) r = probe<Moved>('moveAndRead')
    else {
      runCli(['dev:debug', 'on'])
      r = record(
        'physicalMove',
        evalAsync<Moved>(`(async () => {
        const p = window.__abeleTest.canvasProbe.dragTarget()
        const cdp = require('@electron/remote').getCurrentWebContents().debugger
        const input = (type, x, y, buttons) => cdp.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 })
        await input('mousePressed', p.x, p.y, 1)
        for (let i = 1; i <= 10; i++) {
          await input('mouseMoved', p.x + p.dx * i / 10, p.y + p.dy * i / 10, 1)
          await new Promise(r => setTimeout(r, 20))
        }
        await input('mouseReleased', p.x + p.dx, p.y + p.dy, 0)
        await new Promise(r => setTimeout(r, 300))
        return window.__abeleTest.canvasProbe.readMoved()
      })()`)
      )
    }
    expect(r.moved).toBe(true)
    expect(byId(r.after)).toEqual(byId(r.before))
    shoot('native-after-move')
  }, 120_000)

  // BUG: native Canvas sorts groups before other nodes on save. Array order is not an interop guarantee.
  // Preserve the original discovery assertion; the by-id test above checks field retention separately.
  it.fails(
    'keeps extension values and node array order after a native node move and save',
    () => {
      const r = probe<Moved>('moveAndRead')
      expect(r.moved).toBe(true)
      expect(r.after).toEqual(r.before)
    },
    120_000
  )

  // BUG: native Canvas does not instantiate unknown node types and drops them when serializing.
  it.fails(
    'keeps an unknown node type after native save',
    () => {
      const r = probe<{ kept: boolean }>('unknownType')
      expect(r.kept).toBe(true)
    },
    120_000
  )

  it('rewrites closed canvas file nodes and text links on rename', () => {
    const r = probe<{ file: string; text: string }>('rename')
    expect(r.file).toBe('Sample canvas probe/sample-renamed.md')
    expect(r.text).toContain('sample-renamed')
    expect(r.text).not.toContain('sample-note')
  }, 120_000)

  it('adopts a native canvas leaf by default and allows a native opt-out', () => {
    const r = probe<{ adopted: string; native: string; again: string }>('swap')
    expect(r).toEqual({
      adopted: 'abele-canvas-probe',
      native: 'canvas',
      again: 'abele-canvas-probe',
    })
  }, 120_000)

  it('replaces a native canvas embed in reading view and live preview', () => {
    const r = probe<{ reading: boolean; live: boolean }>('embed')
    expect(r).toEqual({
      reading: true,
      live: true,
      readingNativeHidden: true,
      liveNativeHidden: true,
    })
    shoot('live-embed')
  }, 120_000)

  it('extracts vertices, groups and labelled edges from bundled Mermaid', () => {
    const r = probe<{ nodes: string[]; edges: string[]; groups: string[] }>('mermaid')
    expect(r.nodes).toEqual(['alpha', 'beta', 'gamma'])
    expect(r.edges).toContain('alpha->beta:next')
    expect(r.groups).toContain('level')
  }, 120_000)

  it('does not delete a pre-existing folder when setup refuses ownership', () => {
    const r = evalAsync<{ refused: boolean; retained: boolean }>(`(async () => {
      const api = window.__abeleTest.canvasProbe
      await api.cleanup()
      const dir = 'Sample canvas probe'
      await app.vault.createFolder(dir)
      await app.vault.create(dir + '/sample-sentinel.md', 'Sample sentinel')
      let refused = false
      try { await api.setup() } catch { refused = true }
      await api.cleanup()
      const retained = !!app.vault.getAbstractFileByPath(dir + '/sample-sentinel.md')
      const folder = app.vault.getAbstractFileByPath(dir)
      if (folder) await app.vault.delete(folder, true)
      return { refused, retained }
    })()`)
    expect(r).toEqual({ refused: true, retained: true })
  }, 120_000)
})
