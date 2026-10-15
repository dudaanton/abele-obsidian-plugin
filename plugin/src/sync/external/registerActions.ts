import { Notice, TFile, TFolder, type Plugin, type TAbstractFile, type Menu } from 'obsidian'
import { confirmDialog } from '@/components/obsidian/dialogs'
import { externalActionsOf } from './actionHost'
import { tokenOffloadsOf } from '../tokenOffloadCoordinator'
import { pathCoordinatorOf } from '../pathCoordinator'
import type { OffloadPreview } from './fileActions'
import { externalLinkPath, recordExternalOpening } from './fileAccess'
import { openExternalFile } from './opening'

export const actionTitles = {
  evict: 'Keep only on the server',
  pin: 'Keep on this device',
  hydrate: 'Download to this device',
} as const

export function externalStatus(status: string): string {
  return (
    (
      {
        complete: 'Done',
        'cleanup-pending': 'Saved; local cleanup is still pending',
        pinned: 'Kept on this device. Allow removal first',
        busy: 'Open in an editor or currently in use. Close it and try again',
        'local-changed': 'Unsent changes stay on this device. Sync first',
        'version-changed': 'The version changed. Preview again',
        'rule-no-longer-matches': 'The file no longer matches this rule. Preview again',
        offline: 'Unavailable offline',
        unavailable: 'This file is not available on the server',
        'not-on-server': 'This version is not yet on the server. Sync first; the file stays here',
        refused: 'Sync refused this file. Resolve its sync status first; it stays here',
        'unsupported-server': 'This server does not support offloading',
        'unsupported-storage': 'This device storage does not support safe offloading',
        'no-space': 'Not enough space to download safely',
        collision: 'Another file occupies the destination. Both files were kept',
        ineligible: 'This file cannot be offloaded',
        'already-offloaded': 'Already kept only on the server',
        'approval-required': 'Executable files stay on this device',
        'warning-required': 'This connection needs an access review before offloading',
        'recovery-required': 'Sync recovery is required. The file stays here',
      } as Record<string, string>
    )[status] ?? status
  )
}

export async function confirmOffload(
  plugin: Pick<Plugin, 'app'>,
  preview: OffloadPreview
): Promise<boolean> {
  if (!preview.files.length) {
    new Notice(
      preview.skipped.map((file) => `${file.path}: ${externalStatus(file.status)}`).join('\n') ||
        'No files match.'
    )
    return false
  }
  return confirmDialog({
    title: actionTitles.evict,
    size: 'tall',
    message:
      `${preview.files.length} files · up to ${(preview.bytes / 1024 / 1024).toFixed(2)} MiB freed on this device. Links stay unchanged.\n\n` +
      preview.files.map((file) => `${file.path} · ${file.size} bytes`).join('\n') +
      (preview.skipped.length
        ? '\n\nKept here:\n' +
          preview.skipped.map((file) => `${file.path}: ${externalStatus(file.status)}`).join('\n')
        : ''),
    confirmText: actionTitles.evict,
    confirmTooltip: 'Remove only the confirmed local versions after server verification',
  })
}

export function registerExternalFileActions(plugin: Plugin): void {
  const { app } = plugin
  const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
  // Follow ordinary file links; embedded previews remain the separate rendering seam.
  const followLink = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return
    const element = event.target as Element | null
    const link = element?.closest<HTMLAnchorElement>('a.internal-link')
    if (!link || link.closest('.internal-embed')) return
    const href = link.getAttribute('data-href') ?? link.getAttribute('href') ?? ''
    const hash = href.indexOf('#')
    const target = hash < 0 ? href : href.slice(0, hash)
    const source = app.workspace.getActiveFile()?.path ?? ''
    const path = externalLinkPath(app, target, source)
    if (!path || !manager.isOffloaded(path)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    void openExternalFile(
      app,
      path,
      app.workspace.getLeaf(event.metaKey || event.ctrlKey ? 'tab' : false),
      hash < 0 ? '' : href.slice(hash)
    ).catch((error) => {
      console.debug('[abele-sync] linked external file could not be downloaded', error)
      new Notice('Could not open the external file card: ' + path)
    })
  }
  const listen = (doc: Document) =>
    plugin.registerDomEvent(doc, 'click', followLink, { capture: true })
  listen(document)
  plugin.registerEvent(app.workspace.on('window-open', (_window, win) => listen(win.document)))
  const pathsOf = (files: readonly TAbstractFile[]) => {
    const paths = new Set<string>()
    for (const file of files) {
      if (file instanceof TFolder) {
        for (const item of app.vault.getFiles())
          if (!file.path || file.path === '/' || item.path.startsWith(file.path + '/'))
            paths.add(manager.originalPath(item.path))
      } else paths.add(manager.originalPath(file.path))
    }
    return [...paths]
  }
  const run = async (kind: keyof typeof actionTitles, paths: string[]) => {
    try {
      const host = externalActionsOf.get(app.vault)
      if (!host) throw new Error('Connections are unavailable')
      if (kind === 'evict') {
        const actions = host.actions(),
          preview = await actions.preview(paths)
        if (!(await confirmOffload(plugin, preview))) return
        const results = await actions.apply(preview)
        new Notice(results.map((file) => `${file.path}: ${externalStatus(file.status)}`).join('\n'))
      } else {
        const results: string[] = []
        const state = kind === 'pin' ? await host.actions().preview(paths) : null
        const pinnable = state
          ? state.files.length +
            state.skipped.filter(
              (file) => !['ineligible', 'approval-required', 'not-on-server'].includes(file.status)
            ).length
          : 0
        const pinned = state
          ? pinnable > 0 &&
            state.skipped.filter((file) => file.status === 'pinned').length === pinnable
          : false
        for (const path of paths) {
          try {
            if (kind === 'hydrate') await host.hydrate(path)
            else {
              await host.pin(path, !pinned)
            }
            results.push(
              `${path}: ${kind === 'hydrate' ? 'Downloaded to this device' : pinned ? 'Pin removed; confirmed actions may remove the local copy' : 'Kept on this device'}`
            )
          } catch (error) {
            results.push(
              `${path}: ${externalStatus(error instanceof Error ? error.message : String(error))}`
            )
          }
        }
        new Notice(results.join('\n'))
      }
    } catch (error) {
      console.debug('[abele-sync] external file action did not finish', error)
      new Notice(externalStatus(error instanceof Error ? error.message : String(error)))
    }
  }
  const menuFor = (menu: Menu, files: readonly TAbstractFile[]) => {
    for (const kind of Object.keys(actionTitles) as (keyof typeof actionTitles)[])
      menu.addItem((item) =>
        item
          .setTitle(actionTitles[kind])
          .setIcon(kind === 'evict' ? 'cloud' : kind === 'hydrate' ? 'download' : 'pin')
          .onClick(() => run(kind, pathsOf(files)))
      )
  }
  plugin.registerEvent(app.workspace.on('file-menu', (menu, file) => menuFor(menu, [file])))
  plugin.registerEvent(app.workspace.on('files-menu', (menu, files) => menuFor(menu, files)))
  for (const kind of Object.keys(actionTitles) as (keyof typeof actionTitles)[])
    plugin.addCommand({
      id: `external-file-${kind}`,
      name: actionTitles[kind],
      checkCallback: (checking) => {
        const file = app.workspace.getActiveFile()
        if (!file) return false
        if (!checking) void run(kind, pathsOf([file]))
        return true
      },
    })
  plugin.registerEvent(
    app.workspace.on('file-open', (file) => {
      if (file instanceof TFile) {
        recordExternalOpening(app, file.path)
      }
    })
  )
}
