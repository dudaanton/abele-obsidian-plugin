/**
 * `screenshot` with a `view` argument: a picture of the script view as it is on screen.
 *
 * The rule the person set: only what is visible. A tab behind another has no box and is
 * refused; a view half scrolled off the top is captured from the window's edge; what is
 * out of sight stays out of the picture. The capture itself is handed in, so the test reads
 * exactly what would have been photographed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createScreenshotTool, visibleRect, type VisibleRect } from '@/ai/tools/ScreenshotTool'
import { GlobalStore } from '@/stores/GlobalStore'
import type { ScriptViewModel } from '@/views/ScriptView'
import { View, type ViewHost } from '@/scripting/view/View'
import { useVault } from '../helpers/testEnv'

const host: ViewHost = { async open() {}, close() {} }

/** A leaf as the workspace lays it out: a `.view-content` with the teleport target inside. */
function leaf(box: Partial<DOMRect> | null) {
  const content = document.createElement('div')
  content.className = 'view-content'
  const el = document.createElement('div')
  content.appendChild(el)
  document.body.appendChild(content)
  content.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, ...box }) as DOMRect
  return { content, el }
}

const tab = (over: Partial<ScriptViewModel>): ScriptViewModel =>
  ({
    id: 'leaf',
    el: null,
    view: null,
    status: { kind: 'live' },
    saved: null,
    runAgain: () => {},
    ...over,
  }) as ScriptViewModel

let shots: Array<{ el: HTMLElement; rect: VisibleRect }>
const capture = async (el: HTMLElement, rect: VisibleRect) => {
  shots.push({ el, rect })
  return 'data:image/png;base64,AAAA'
}

beforeEach(() => {
  useVault([])
  shots = []
  document.body.innerHTML = ''
  Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true })
})

describe('visibleRect', () => {
  it('clips the element to the window and rounds to whole pixels', () => {
    const { content } = leaf({ left: -20.4, top: 100, right: 900, bottom: 700 })

    expect(visibleRect(content)).toEqual({ x: 0, y: 100, width: 800, height: 500 })
  })

  it('is nothing for an element with no box, or one entirely off screen', () => {
    expect(visibleRect(leaf(null).content)).toBeNull()
    expect(visibleRect(leaf({ left: 0, top: 700, right: 300, bottom: 900 }).content)).toBeNull()
    const detached = document.createElement('div')
    expect(visibleRect(detached)).toBeNull()
  })
})

describe('screenshot of a script view', () => {
  it('captures the visible part of the leaf the view is in, and hands the picture to the agent', async () => {
    const view = new View({ title: 'Feed' }, host, { script: 'Feed script', params: {} })
    const { content, el } = leaf({ left: 300, top: 40, right: 1000, bottom: 640 })
    GlobalStore.getInstance().scriptViews.value = [tab({ view, el })]

    const result = await createScreenshotTool(capture).execute('1', { view: 'feed script' })

    expect(shots).toHaveLength(1)
    expect(shots[0].el).toBe(content)
    expect(shots[0].rect).toEqual({ x: 300, y: 40, width: 500, height: 560 })
    // Kept in the vault and named in the result, which is where the chat reads it back from
    // to show the person the same picture.
    expect(result.content[0].text).toMatch(/^Screenshot saved: Attachments\/Screenshot Feed \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.png$/)
    const saved = result.content[0].text.replace('Screenshot saved: ', '')
    expect(GlobalStore.getInstance().app.vault.getAbstractFileByPath(saved)).not.toBeNull()
    const injected = result.injectMessages?.[0].content as Array<Record<string, unknown>>
    expect(injected[0].text).toContain('the visible part of the tab, 500×560')
    expect(injected[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } })
  })

  it('takes the tab that is on screen when two share a name', async () => {
    const hidden = leaf(null)
    const shown = leaf({ left: 0, top: 0, right: 400, bottom: 300 })
    GlobalStore.getInstance().scriptViews.value = [
      tab({ id: 'a', view: new View({ title: 'Feed' }, host, { script: 'Feed', params: {} }), el: hidden.el }),
      tab({ id: 'b', view: new View({ title: 'Feed' }, host, { script: 'Feed', params: {} }), el: shown.el }),
    ]

    await createScreenshotTool(capture).execute('1b', { view: 'Feed' })

    expect(shots[0].el).toBe(shown.content)
  })

  it('refuses a view that is not on screen, and says why', async () => {
    const view = new View({ title: 'Feed' }, host, { script: 'Feed script', params: {} })
    const { el } = leaf(null)
    GlobalStore.getInstance().scriptViews.value = [tab({ view, el })]

    await expect(createScreenshotTool(capture).execute('2', { view: 'Feed' })).rejects.toThrow(
      'View "Feed" is not on screen'
    )
    expect(shots).toHaveLength(0)
  })

  it('names the open views when the name matches none, like inspect_view does', async () => {
    const view = new View({ title: 'Feed' }, host, { script: 'Feed script', params: {} })
    GlobalStore.getInstance().scriptViews.value = [
      tab({ view, el: leaf(null).el }),
      tab({ id: 'x', status: { kind: 'failed', script: 'Broken', message: 'boom' } } as Partial<ScriptViewModel>),
    ]

    await expect(createScreenshotTool(capture).execute('3', { view: 'nope' })).rejects.toThrow(
      'No script view named "nope". Open: "Feed" (Feed script), "Broken" (failed: boom)'
    )
  })

  it('still needs a path or a view', async () => {
    await expect(createScreenshotTool(capture).execute('4', {})).rejects.toThrow('path or view')
  })

  it('does not go through the vault scope: a view is not a file', async () => {
    const view = new View({ title: 'Feed' }, host, { script: 'Feed script', params: {} })
    const { el } = leaf({ left: 0, top: 0, right: 100, bottom: 100 })
    GlobalStore.getInstance().scriptViews.value = [tab({ view, el })]
    const scope = vi.spyOn(
      (await import('@/ai/ScopeResolver')).ScopeResolver.getInstance(),
      'isInScope'
    )

    await createScreenshotTool(capture).execute('5', { view: 'Feed' })

    expect(scope).not.toHaveBeenCalled()
  })
})
