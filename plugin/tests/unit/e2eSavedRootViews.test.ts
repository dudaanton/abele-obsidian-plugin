import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../e2e/helpers/obsidianCli', () => ({
  evalLong: async (code: string) => new Function(`return ${code}`)(),
}))
import { assertNoLeakedSavedRootViews, snapshotSavedRootViews } from '../e2e/helpers/savedRootViews'

const tab = (id: string, type: string) => ({ id, type: 'leaf', state: { type } })

function fixture() {
  const layouts: Record<string, string> = {
    'sample-config/workspace.json': JSON.stringify({
      main: { children: [tab('desktop-note', 'markdown')] },
    }),
    'sample-config/workspace-mobile.json': JSON.stringify({
      main: {
        children: [
          {
            currentTab: 1,
            children: [
              tab('mobile-note', 'markdown'),
              tab('retained-panel', 'abele-ai-sidebar-view'),
            ],
          },
        ],
      },
    }),
  }
  const write = vi.fn(async (path: string, text: string) => {
    layouts[path] = text
  })
  vi.stubGlobal('app', {
    workspace: { requestSaveLayout: { run: vi.fn(async () => {}) } },
    vault: {
      configDir: 'sample-config',
      adapter: {
        exists: async (path: string) => path in layouts,
        read: async (path: string) => layouts[path],
        write,
      },
    },
  })
  const mobile = () => JSON.parse(layouts['sample-config/workspace-mobile.json'])
  const setMobile = (layout: unknown) => {
    layouts['sample-config/workspace-mobile.json'] = JSON.stringify(layout)
  }
  return { layouts, mobile, setMobile, write }
}

afterEach(() => vi.unstubAllGlobals())

describe('saved root ownership after leaving phone emulation', () => {
  it('fails and removes only newly added mobile panes while desktop is already restored', async () => {
    const f = fixture()
    const before = await snapshotSavedRootViews()
    const layout = f.mobile(),
      group = layout.main.children[0]
    group.children.unshift(
      tab('leaked-chat', 'abele-ai-sidebar-view'),
      tab('leaked-runs', 'abele-script-runs-view')
    )
    group.currentTab = 3
    f.setMobile(layout)
    await expect(assertNoLeakedSavedRootViews(before)).rejects.toThrow('workspace-mobile.json')
    expect(f.mobile().main.children[0]).toMatchObject({
      currentTab: 1,
      children: [tab('mobile-note', 'markdown'), tab('retained-panel', 'abele-ai-sidebar-view')],
    })
    expect(f.write).toHaveBeenCalledOnce()
    expect(f.layouts['sample-config/workspace.json']).toContain('desktop-note')
  })

  it('reports a converted pre-existing tab without removing it', async () => {
    const f = fixture()
    const before = await snapshotSavedRootViews()
    const layout = f.mobile()
    layout.main.children[0].children[0].state.type = 'abele-script-view'
    f.setMobile(layout)
    await expect(assertNoLeakedSavedRootViews(before)).rejects.toThrow('abele-script-view')
    expect(f.write).not.toHaveBeenCalled()
    expect(f.mobile().main.children[0].children).toHaveLength(2)
  })

  it('preserves pre-existing panels and ordinary new note tabs without rewriting the layout', async () => {
    const f = fixture()
    const before = await snapshotSavedRootViews()
    const layout = f.mobile()
    layout.main.children[0].children.push(tab('new-note', 'markdown'))
    f.setMobile(layout)
    await expect(assertNoLeakedSavedRootViews(before)).resolves.toBeUndefined()
    expect(f.write).not.toHaveBeenCalled()
  })
})
