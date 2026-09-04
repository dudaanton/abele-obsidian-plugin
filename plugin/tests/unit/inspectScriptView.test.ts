/**
 * `inspect_view` with a `view` argument answers from the script's tree, not the DOM, and
 * names the open tabs when the one asked for is not there — including a tab whose script is
 * still running or has failed, which has no view to describe but is often the one meant.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createInspectViewTool } from '@/ai/tools/InspectViewTool'
import { GlobalStore } from '@/stores/GlobalStore'
import type { ScriptViewModel } from '@/views/ScriptView'
import { View, type ViewHost } from '@/scripting/view/View'
import { Button, Text } from '@/scripting/view/components'
import { useVault } from '../helpers/testEnv'

const host: ViewHost = { async open() {}, close() {} }
const view = new View({ title: 'Feed' }, host, { script: 'Feed script', params: {} })
view.body = [new Button({ text: 'Refresh' })]

/** A tab as the Vue side sees it: the model every script leaf puts in the store. */
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

/** What `inspect_view` will not go past for one answer, as the path route has always clamped. */
const MAX_OUTPUT = 15_000

beforeEach(() => {
  useVault([])
  open(tab({ id: 'feed', view }))
})

describe('inspect_view for a script view', () => {
  it('finds a view by title or script name', async () => {
    const tool = createInspectViewTool()
    const byTitle = await tool.execute('1', { view: 'feed' })
    expect(byTitle.content[0].text).toContain('Button "Refresh"')
    const byScript = await tool.execute('2', { view: 'Feed script' })
    expect(byScript.content[0].text).toContain('View "Feed"')
  })

  it('says which views are open when the name matches none', async () => {
    const tool = createInspectViewTool()
    await expect(tool.execute('3', { view: 'nope' })).rejects.toThrow(
      'No script view named "nope". Open: "Feed" (Feed script)'
    )
  })

  it('still needs a path or a view', async () => {
    await expect(createInspectViewTool().execute('4', {})).rejects.toThrow('path or view')
  })

  it('cuts a view too long to send back, and says so', async () => {
    const big = new View({ title: 'Big' }, host, { script: 'Big', params: {} })
    big.body = Array.from({ length: 2000 }, (_, i) => new Text(`line ${i}`))
    open(tab({ id: 'feed', view }), tab({ id: 'big', view: big }))
    const out = await createInspectViewTool().execute('5', { view: 'Big' })
    const text = out.content[0].text as string
    expect(text).toContain('[Output truncated.')
    expect(text.length).toBeLessThanOrEqual(MAX_OUTPUT + 100)
  })

  it('names a tab whose script is still running or has failed', async () => {
    open(
      tab({ id: 'feed', view }),
      tab({ id: 'x', status: { kind: 'failed', script: 'X', message: 'boom' }, saved: null }),
      tab({ id: 'y', status: { kind: 'starting', script: 'Y' } })
    )
    await expect(createInspectViewTool().execute('6', { view: 'nope' })).rejects.toThrow(
      'Open: "Feed" (Feed script), "X" (failed: boom), "Y" (starting)'
    )
  })
})
