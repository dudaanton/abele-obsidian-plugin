import { t } from '@/i18n'
// Where a note about a recorded run goes: a folder of the vault, or any folder of this computer
// named by its absolute path. The setting travels to the person's other devices, where that path
// may not exist; there the note is refused with the reason rather than written somewhere else.
import { normalizePath, Platform, type App } from 'obsidian'

export type NotesFolder = { kind: 'vault'; path: string } | { kind: 'outside'; path: string }

/** `/…`, `C:\…` or `\\server\…`: a place on the device's disk rather than in the vault. */
export const isAbsoluteFolder = (folder: string) => /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(folder.trim())

/** Without the separators at the end, except the one that is the whole root. */
const trimEnd = (path: string) => path.slice(0, 1) + path.slice(1).replace(/[\\/]+$/, '')

/** The setting read against this vault; an absolute path inside the vault is a vault folder. */
export function notesFolder(setting: string, vaultBase?: string): NotesFolder {
  const raw = setting.trim() || 'Trace'
  if (!isAbsoluteFolder(raw)) return { kind: 'vault', path: normalizePath(raw) }
  const path = trimEnd(raw)
  if (vaultBase) {
    const base = trimEnd(vaultBase)
    if (path === base) return { kind: 'vault', path: '' }
    for (const sep of ['/', '\\'])
      if (path.startsWith(base + sep))
        return { kind: 'vault', path: normalizePath(path.slice(base.length + 1)) }
  }
  return { kind: 'outside', path }
}

interface DiskFs {
  stat(path: string): Promise<{ isDirectory(): boolean }>
  writeFile(path: string, data: string, options: { flag: string }): Promise<void>
}
interface DesktopAdapter {
  getBasePath?: () => string
  fsPromises?: DiskFs
}

export class NotesFolderUnavailable extends Error {}

type FolderFailure = { kind: 'unsupported' | 'missing'; path: string }
const folderFailures = new WeakMap<object, FolderFailure>()

function unavailable(kind: FolderFailure['kind'], path: string): NotesFolderUnavailable {
  const error = new NotesFolderUnavailable(
    kind === 'unsupported'
      ? `The folder for notes about runs, ${path}, is outside the vault, and this device cannot write there. Choose a vault folder in Settings → Nodes.`
      : `The folder for notes about runs, ${path}, is not on this device. Choose one in Settings → Nodes.`
  )
  folderFailures.set(error, { kind, path })
  return error
}

/** UI projection; callers still receive the original exception without extra serialized fields. */
export function notesFolderFailureText(error: unknown): string | undefined {
  const failure = error && typeof error === 'object' ? folderFailures.get(error) : undefined
  if (!failure) return undefined
  return failure.kind === 'unsupported'
    ? t('streamC.c54aefb5a321afff', { v1: failure.path })
    : t('streamC.b6bb5feb524bf16c', { v1: failure.path })
}

/**
 * Writes the note under the first free name (`name.md`, `name 2.md`, …) and says where. A note
 * already there is never overwritten.
 */
export async function saveRunNote(
  app: App,
  setting: string,
  name: string,
  text: string
): Promise<{ path: string; outside: boolean }> {
  const adapter = app.vault.adapter as unknown as DesktopAdapter
  const folder = notesFolder(setting, adapter.getBasePath?.())
  if (folder.kind === 'vault') {
    if (folder.path && !app.vault.getAbstractFileByPath(folder.path))
      await app.vault.createFolder(folder.path)
    const base = folder.path ? `${folder.path}/${name}` : name
    let path = `${base}.md`
    for (let i = 2; app.vault.getAbstractFileByPath(path); i++) path = `${base} ${i}.md`
    await app.vault.create(path, text)
    return { path, outside: false }
  }
  const fs = adapter.fsPromises
  if (!fs) throw unavailable('unsupported', folder.path)
  const found = await fs.stat(folder.path).catch((): undefined => undefined)
  if (!found?.isDirectory()) throw unavailable('missing', folder.path)
  const sep = folder.path.includes('\\') && !folder.path.includes('/') ? '\\' : '/'
  const base = `${folder.path}${folder.path.endsWith(sep) ? '' : sep}${name}`
  for (let i = 1; ; i++) {
    const path = i === 1 ? `${base}.md` : `${base} ${i}.md`
    try {
      await fs.writeFile(path, text, { flag: 'wx' })
      return { path, outside: true }
    } catch (e) {
      if ((e as { code?: string }).code !== 'EEXIST' || i > 999) throw e
    }
  }
}

/** The computer's own folder dialog; undefined on a phone or when the person cancels. */
export async function chooseOutsideFolder(): Promise<string | undefined> {
  if (!Platform.isDesktopApp) return undefined
  try {
    const req = (window as unknown as { require?: (name: string) => unknown }).require
    const remote = req?.('@electron/remote') as
      | {
          dialog: {
            showOpenDialog(options: {
              title: string
              properties: string[]
            }): Promise<{ canceled: boolean; filePaths: string[] }>
          }
        }
      | undefined
    if (!remote) return undefined
    const r = await remote.dialog.showOpenDialog({
      title: t('settings.nodes.traceFolder'),
      properties: ['openDirectory', 'createDirectory'],
    })
    return r.canceled ? undefined : r.filePaths[0]
  } catch (e) {
    console.debug('[trace] Folder dialog unavailable', e)
    return undefined
  }
}
