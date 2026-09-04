/**
 * `inspect_view` with a `view` argument answers from the script's tree, not the DOM, and
 * names the open views when the one asked for is not there.
 */
import { describe, it, expect, vi } from 'vitest'
import { createInspectViewTool } from '@/ai/tools/InspectViewTool'
import { View, type ViewHost } from '@/scripting/view/View'
import { Button, Text } from '@/scripting/view/components'

const host: ViewHost = { async open() {}, close() {} }
const view = new View({ title: 'Feed' }, host, { script: 'Feed script', params: {} })
view.body = [new Button({ text: 'Refresh' })]

/** What the service would report, per test: a tab with a view, or one still running or failed. */
const leaves: Array<{ model: Record<string, unknown> }> = [{ model: { view } }]

vi.mock('@/scripting/view/ScriptViewService', () => ({
  ScriptViewService: { getInstance: () => ({ leaves: () => leaves }) },
}))

/** What `inspect_view` will not go past for one answer, as the path route has always clamped. */
const MAX_OUTPUT = 15_000

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
    leaves.push({ model: { view: big } })
    const out = await createInspectViewTool().execute('5', { view: 'Big' })
    const text = out.content[0].text as string
    expect(text).toContain('[Output truncated.')
    expect(text.length).toBeLessThanOrEqual(MAX_OUTPUT + 100)
  })

  it('names a tab whose script is still running or has failed', async () => {
    leaves.push({
      model: {
        view: null,
        status: { kind: 'failed', script: 'X', message: 'boom' },
        saved: { script: 'X' },
      },
    })
    await expect(createInspectViewTool().execute('6', { view: 'nope' })).rejects.toThrow(
      '"X" (failed: boom)'
    )
  })
})
