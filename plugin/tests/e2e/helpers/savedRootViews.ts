/** Also guard the inactive layout: emulated mobile has a separate saved root split. */
import { evalLong } from './obsidianCli'
import type { RootView } from './rootViews'

export type SavedRootViews = Record<string, RootView[]>

const layouts = ['workspace.json', 'workspace-mobile.json']

export async function snapshotSavedRootViews(): Promise<SavedRootViews> {
  return JSON.parse(
    await evalLong(
      `(async () => {
    await app.workspace.requestSaveLayout.run()
    const result = {}
    for (const name of ${JSON.stringify(layouts)}) {
      const path = app.vault.configDir + '/' + name
      result[name] = []
      if (!await app.vault.adapter.exists(path)) continue
      const layout = JSON.parse(await app.vault.adapter.read(path))
      const visit = node => {
        if (node.type === 'leaf') result[name].push({id: node.id, type: node.state.type})
        for (const child of node.children ?? []) visit(child)
      }
      visit(layout.main)
    }
    return JSON.stringify(result)
  })()`,
      30_000
    )
  ) as SavedRootViews
}

export async function assertNoLeakedSavedRootViews(before: SavedRootViews): Promise<void> {
  const leaked = JSON.parse(
    await evalLong(
      `(async () => {
    const before = ${JSON.stringify(before)}, leaked = []
    for (const name of ${JSON.stringify(layouts)}) {
      const path = app.vault.configDir + '/' + name
      if (!await app.vault.adapter.exists(path)) continue
      const layout = JSON.parse(await app.vault.adapter.read(path))
      let changed = false
      const keep = node => {
        if (node.type === 'leaf' && node.state.type.startsWith('abele-') &&
          !(before[name] ?? []).some(old => old.id === node.id && old.type === node.state.type)) {
          leaked.push({layout: name, id: node.id, type: node.state.type})
          // Only a new leaf is owned by this file; never remove a converted pre-existing tab.
          if (!(before[name] ?? []).some(old => old.id === node.id)) { changed = true; return false }
        }
        if (node.children) {
          const selected = node.children[node.currentTab]
          node.children = node.children.filter(keep)
          if (typeof node.currentTab === 'number') node.currentTab = Math.max(0, node.children.indexOf(selected))
        }
        return true
      }
      keep(layout.main)
      if (changed) await app.vault.adapter.write(path, JSON.stringify(layout))
    }
    return JSON.stringify(leaked)
  })()`,
      30_000
    )
  ) as Array<RootView & { layout: string }>
  if (leaked.length)
    throw new Error(`Leaked plugin views in saved main areas: ${JSON.stringify(leaked)}`)
}
