/**
 * `screenshot` with a `view` argument captures a script's tab, the way `inspect_view` reads
 * one — by tab title or script name, naming the open tabs when the one asked for is not there.
 * A view the agent has just written is what it most wants to look at, and until now the tool
 * took only a note path.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createScreenshotTool } from '@/ai/tools/ScreenshotTool'
import { GlobalStore } from '@/stores/GlobalStore'
import type { ScriptViewModel } from '@/views/ScriptView'
import { View, type ViewHost } from '@/scripting/view/View'
import { Text } from '@/scripting/view/components'
import { useVault } from '../helpers/testEnv'

const toPng = vi.fn(async () => 'data:image/png;base64,AAAA')
vi.mock('dom-to-image-more', () => ({ default: { toPng: (...args: unknown[]) => toPng(...args) } }))

const host: ViewHost = { async open() {}, close() {} }
const view = new View({ title: 'Feed' }, host, { script: 'Feed script', params: {} })
view.body = [new Text({ text: 'Hello' })]

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

const open = (...tabs: ScriptViewModel[]) => {
  GlobalStore.getInstance().scriptViews.value = tabs
}

beforeEach(() => {
  useVault([])
  toPng.mockClear()
})

describe('screenshot of a script view', () => {
  it('captures the element of the tab named, by title or by script', async () => {
    const el = document.createElement('div')
    open(tab({ id: 'feed', view, el }))
    const tool = createScreenshotTool()

    const result = await tool.execute('1', { view: 'feed' })

    expect(toPng.mock.calls[0][0]).toBe(el)
    expect(result.content[0].text).toBe('Screenshot captured: view "Feed"')
    const parts = result.injectMessages?.[0].content as {
      type: string
      image_url?: { url: string }
    }[]
    expect(parts.find((p) => p.type === 'image_url')?.image_url?.url).toBe(
      'data:image/png;base64,AAAA'
    )

    await tool.execute('2', { view: 'Feed script' })
    expect(toPng).toHaveBeenCalledTimes(2)
  })

  it('says which views are open when the name matches none', async () => {
    open(tab({ id: 'feed', view, el: document.createElement('div') }))

    await expect(createScreenshotTool().execute('3', { view: 'nope' })).rejects.toThrow(
      'No script view named "nope". Open: "Feed" (Feed script)'
    )
  })

  it('says so when the tab has nothing on screen yet', async () => {
    open(tab({ id: 'feed', view, el: null }))

    await expect(createScreenshotTool().execute('4', { view: 'feed' })).rejects.toThrow(
      'nothing on screen yet'
    )
    expect(toPng).not.toHaveBeenCalled()
  })

  it('still needs a path or a view', async () => {
    await expect(createScreenshotTool().execute('5', {})).rejects.toThrow('path or view')
  })
})
