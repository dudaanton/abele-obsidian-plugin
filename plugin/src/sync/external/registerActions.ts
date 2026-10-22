import type { SyncText } from '../presentation'
import { settingsSyncText } from '@/i18n/settingsSync'
import { streamCUI } from '@/i18n/streamCLabels'
import { t } from '@/i18n'
import { Notice, TFile, TFolder, type Plugin, type TAbstractFile, type Menu } from 'obsidian'
import { confirmDialog } from '@/components/obsidian/dialogs'
import { externalActionsOf } from './actionHost'
import { tokenOffloadsOf } from '../tokenOffloadCoordinator'
import { pathCoordinatorOf } from '../pathCoordinator'
import type { OffloadPreview } from './fileActions'
import { externalLinkPath, recordExternalOpening } from './fileAccess'
import { openExternalFile } from './opening'
import { SyncActionNotice } from '../actionNotice'

export const actionTitles = {
  evict: 'Keep only on the server',
  pin: 'Keep on this device',
  hydrate: 'Download to this device',
} as const

export function externalStatus(status: string, text: SyncText = settingsSyncText): string {
  const message = (
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
  )[status]
  return message === undefined ? status : text(message)
}

export async function confirmOffload(
  plugin: Pick<Plugin, 'app'>,
  preview: OffloadPreview
): Promise<boolean> {
  if (!preview.files.length) {
    new Notice(
      preview.skipped.map((file) => `${file.path}: ${externalStatus(file.status)}`).join('\n') ||
        t('streamC.2ccf94bf0ca23256')
    )
    return false
  }
  return confirmDialog({
    title: streamCUI(actionTitles.evict),
    size: 'tall',
    message:
      t('streamC.cbf96227cfd83246', {
        v1: preview.files.length,
        v2: (preview.bytes / 1024 / 1024).toFixed(2),
      }) +
      '\n\n' +
      preview.files
        .map((file) =>
          t('streamC.6529bdb841d34223', { v1: String(file.path), v2: String(file.size) })
        )
        .join('\n') +
      (preview.skipped.length
        ? '\n\n' +
          t('streamC.de32a506113b3695') +
          '\n' +
          preview.skipped.map((file) => `${file.path}: ${externalStatus(file.status)}`).join('\n')
        : ''),
    confirmText: streamCUI(actionTitles.evict),
    confirmTooltip: t('streamC.7e49042a94a6ff74'),
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
      new Notice(t('streamC.da4af4eb96fcc9d1', { v1: path }))
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
    let progress: SyncActionNotice | undefined
    try {
      const host = externalActionsOf.get(app.vault)
      if (!host) throw new Error('Connections are unavailable')
      if (kind === 'evict') {
        const actions = host.actions(),
          preview = await actions.preview(paths)
        if (!(await confirmOffload(plugin, preview))) return
        progress = new SyncActionNotice(streamCUI(actionTitles[kind]))
        const results = await actions.apply(preview)
        progress.finish(
          results.map((file) => `${file.path}: ${externalStatus(file.status)}`).join('\n')
        )
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
        progress = new SyncActionNotice(streamCUI(actionTitles[kind]))
        for (const path of paths) {
          progress.update(`${streamCUI(actionTitles[kind])}: ${results.length}/${paths.length}`)
          try {
            if (kind === 'hydrate') await host.hydrate(path)
            else {
              await host.pin(path, !pinned)
            }
            results.push(
              `${path}: ${kind === 'hydrate' ? t('streamC.0bdee1a2ab7e273e') : pinned ? t('streamC.2c2d8598672f5487') : t('streamC.cd773d4c4aca1c8c')}`
            )
          } catch (error) {
            results.push(
              `${path}: ${externalStatus(error instanceof Error ? error.message : String(error))}`
            )
          }
        }
        progress.finish(results.join('\n'))
      }
    } catch (error) {
      console.debug('[abele-sync] external file action did not finish', error)
      const message = externalStatus(error instanceof Error ? error.message : String(error))
      if (progress) progress.finish(message)
      else new Notice(message)
    }
  }
  const menuFor = (menu: Menu, files: readonly TAbstractFile[]) => {
    for (const kind of Object.keys(actionTitles) as (keyof typeof actionTitles)[])
      menu.addItem((item) =>
        item
          .setTitle(streamCUI(actionTitles[kind]))
          .setIcon(kind === 'evict' ? 'cloud' : kind === 'hydrate' ? 'download' : 'pin')
          .onClick(() => run(kind, pathsOf(files)))
      )
  }
  plugin.registerEvent(app.workspace.on('file-menu', (menu, file) => menuFor(menu, [file])))
  plugin.registerEvent(app.workspace.on('files-menu', (menu, files) => menuFor(menu, files)))
  for (const kind of Object.keys(actionTitles) as (keyof typeof actionTitles)[])
    plugin.addCommand({
      id: `external-file-${kind}`,
      name: t(`commands.external-file-${kind}`),
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
