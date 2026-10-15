import { WorkspaceLeaf, type App, type Workspace, type TFile } from 'obsidian'
import type { TokenOffloadCoordinator } from '../tokenOffloadCoordinator'
import { externalLinkPath } from './fileAccess'

export const EXTERNAL_VIEW_TYPE = 'abele-external-file'
export async function openExternalFile(
  app: App,
  path: string,
  leaf = app.workspace.getLeaf('tab'),
  subpath = ''
): Promise<void> {
  await leaf.setViewState({
    type: EXTERNAL_VIEW_TYPE,
    active: true,
    state: { path, ...(subpath ? { subpath } : {}) },
  })
}

/** Route before native lookup, which cannot resolve a deliberately absent original. */
export function routeExternalLinks(app: App, manager: TokenOffloadCoordinator): () => void {
  // Keep the receiver: Obsidian and other wrappers use workspace state through this.
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called with its original receiver below
  const original = app.workspace.openLinkText
  let live = true
  const wrapped: Workspace['openLinkText'] = async function (link, source, pane, state) {
    const path = live ? externalLinkPath(app, link.split('#')[0], source) : null
    const logical = path ? manager.originalPath(path) : null
    if (logical && manager.isOffloaded(logical)) {
      const hash = link.indexOf('#')
      await openExternalFile(
        app,
        logical,
        app.workspace.getLeaf(pane),
        hash < 0 ? '' : link.slice(hash)
      )
      return
    }
    return original.call(this, link, source, pane, state)
  }
  app.workspace.openLinkText = wrapped
  return () => {
    live = false
    if (app.workspace.openLinkText === wrapped) app.workspace.openLinkText = original
  }
}

/** The explorer and other native callers already have a TFile (usually the stub). */
export function routeExternalFiles(
  app: App,
  manager: TokenOffloadCoordinator,
  proto: { openFile: WorkspaceLeaf['openFile'] } = WorkspaceLeaf.prototype
): () => void {
  const original = proto.openFile
  let live = true
  const wrapped: WorkspaceLeaf['openFile'] = async function (file: TFile, state) {
    const path = manager.originalPath(file.path)
    if (live && this.app === app && manager.isOffloaded(path)) {
      await openExternalFile(app, path, this)
      return
    }
    return original.call(this, file, state)
  }
  proto.openFile = wrapped
  return () => {
    live = false
    if (proto.openFile === wrapped) proto.openFile = original
  }
}
