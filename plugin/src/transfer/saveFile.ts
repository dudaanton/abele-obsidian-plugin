/**
 * "Save a file" on the sending screen: where the transfer goes when it goes as a file.
 *
 * Never into the part of the vault a sync carries. A transfer that holds keys is locked by a
 * short code, and one that carries the sync connection holds a live device token: a copy synced
 * to every device, and kept in the server's history of that file, is a copy of the lock beside
 * everything it guards. So the file goes, in order of preference:
 *
 * 1. on the desktop, wherever the person puts it in the system's save dialog — the one
 *    Obsidian's own "Export to PDF" opens;
 * 2. elsewhere, to the system share sheet, which saves to Files, AirDrops or sends it on;
 * 3. and only where neither is there, into a hidden folder of the vault (`HIDDEN_FOLDER`). Abele
 *    Sync leaves every hidden path alone, and a file manager that shows hidden files reaches it.
 *
 * The receiving side reads a file through the system picker, so a file anywhere will do.
 */
import type { App } from 'obsidian'

/** The vault folder the last road writes into: hidden, so no Abele Sync carries it. */
export const HIDDEN_FOLDER = '.abele-transfers'

export type SavedTo =
  /** Written outside the vault, where the person chose. */
  | { road: 'disk'; path: string }
  /** Handed to the share sheet; what happened after that is the system's. */
  | { road: 'shared' }
  /** Written into the vault's hidden folder. */
  | { road: 'vault'; path: string }
  /** The person closed the dialog or the sheet. */
  | { road: 'cancelled' }

export interface SaveRoads {
  /** The system's save dialog: the path chosen, or null when it was closed. */
  pickPath: ((name: string) => Promise<string | null>) | null
  /** Writes a file outside the vault; present whenever `pickPath` is. */
  writeFile: ((path: string, text: string) => Promise<void>) | null
  /** The share sheet, when this window has one that takes files. */
  share: ((file: File) => Promise<void>) | null
}

export async function saveTransfer(
  app: App,
  text: string,
  name: string,
  roads: SaveRoads
): Promise<SavedTo> {
  if (roads.pickPath && roads.writeFile) {
    const path = await roads.pickPath(name)
    if (path === null) return { road: 'cancelled' }
    await roads.writeFile(path, text)
    return { road: 'disk', path }
  }

  if (roads.share) {
    try {
      await roads.share(new File([text], name, { type: 'text/plain' }))
      return { road: 'shared' }
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === 'AbortError') return { road: 'cancelled' }
      // A sheet that would not open — not allowed here, or not for this file — leaves the
      // last road.
      console.debug('[Abele] the share sheet would not take the transfer', error)
    }
  }

  const adapter = app.vault.adapter
  if (!(await adapter.exists(HIDDEN_FOLDER))) await adapter.mkdir(HIDDEN_FOLDER)
  const path = `${HIDDEN_FOLDER}/${name}`
  await adapter.writeBinary(path, new TextEncoder().encode(text).buffer)
  return { road: 'vault', path }
}

interface ElectronRemote {
  dialog: {
    showSaveDialog(options: {
      defaultPath?: string
      filters?: { name: string; extensions: string[] }[]
      properties?: string[]
    }): Promise<{ canceled: boolean; filePath?: string }>
  }
  app: { getPath(name: 'downloads'): string }
}

/** What `window.require` hands back on the desktop, and nothing on a phone. */
function desktopModule<T>(name: string): T | null {
  try {
    const req = (window as unknown as { require?: (name: string) => unknown }).require
    return (req?.(name) as T | undefined) ?? null
  } catch {
    return null
  }
}

/** The roads this window has. `win` is the settings' own window, which may be a popout. */
export function platformRoads(win: Window): SaveRoads {
  const remote = desktopModule<{ remote?: ElectronRemote }>('electron')?.remote ?? null
  const fs = desktopModule<{ promises?: { writeFile(p: string, d: string): Promise<void> } }>(
    'fs'
  )?.promises
  const desktop = remote?.dialog?.showSaveDialog && fs ? { remote, fs } : null

  const nav = win.navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean
  }
  const probe = (): File => new File([''], 'transfer.txt', { type: 'text/plain' })
  const sharesFiles =
    typeof nav.share === 'function' && nav.canShare?.({ files: [probe()] }) === true

  return {
    pickPath: desktop
      ? async (name) => {
          let folder = ''
          try {
            folder = desktop.remote.app.getPath('downloads')
          } catch {
            /* the dialog starts wherever it last was */
          }
          const picked = await desktop.remote.dialog.showSaveDialog({
            defaultPath: folder ? `${folder}/${name}` : name,
            filters: [{ name: 'Text', extensions: ['txt'] }],
            properties: ['showOverwriteConfirmation'],
          })
          return picked.canceled || !picked.filePath ? null : picked.filePath
        }
      : null,
    writeFile: desktop ? (path, text) => desktop.fs.writeFile(path, text) : null,
    share: sharesFiles ? (file) => nav.share({ files: [file], title: file.name }) : null,
  }
}
