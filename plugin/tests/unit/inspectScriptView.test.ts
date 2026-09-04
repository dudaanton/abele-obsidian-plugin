/**
 * `inspect_view` with a `view` argument answers from the script's tree, not the DOM, and
 * names the open views when the one asked for is not there.
 */
import { describe, it, expect, vi } from 'vitest'
import { createInspectViewTool } from '@/ai/tools/InspectViewTool'
import { View, type ViewHost } from '@/scripting/view/View'
import { Button } from '@/scripting/view/components'

const host: ViewHost = { async open() {}, close() {} }
const view = new View({ title: 'Feed' }, host, { script: 'Feed script', params: {} })
view.body = [new Button({ text: 'Refresh' })]

vi.mock('@/scripting/view/ScriptViewService', () => ({
  ScriptViewService: { getInstance: () => ({ leaves: () => [{ model: { view } }] }) },
}))

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
})
