import type { PathMatcher } from '@abele/sync-sdk/core'
import type { LocalStorage } from './ledgerId'
import type { ShareItem } from './shareSets'

const KEY = 'abele-sync-token-state:device-scope-v1'

export function checkedDeviceScope(raw: unknown): ShareItem[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 20)
    throw new Error('Device sync scope requires recovery')
  const items = raw as ShareItem[]
  for (const item of items) {
    if (
      !item ||
      !['vault', 'folder', 'group', 'file'].includes(item.kind) ||
      typeof item.id !== 'string' ||
      !item.id ||
      typeof item.path !== 'string' ||
      !item.path ||
      (item.kind === 'vault'
        ? item.path !== '/'
        : item.path.includes('\\') ||
          item.path.split('/').some((part) => !part || part === '.' || part === '..'))
    )
      throw new Error('Device sync scope requires recovery')
  }
  if (
    new Set(items.map((item) => item.kind + ':' + item.id)).size !== items.length ||
    (items.some((item) => item.kind === 'vault') && items.length !== 1)
  )
    throw new Error('Device sync scope requires recovery')
  return items.map(({ kind, id, path }) => ({ kind, id, path }))
}

/** Missing means the pre-selection default; malformed saved data must never mean everything. */
export function readDeviceScope(storage: LocalStorage): ShareItem[] | null {
  const raw = storage.loadLocalStorage(KEY)
  return raw == null ? null : checkedDeviceScope(raw)
}

export function writeDeviceScope(storage: LocalStorage, items: ShareItem[]): void {
  const value = checkedDeviceScope(items)
  storage.saveLocalStorage(KEY, value)
  if (JSON.stringify(readDeviceScope(storage)) !== JSON.stringify(value))
    throw new Error('Device sync scope could not be saved')
}

/** Paths are host-relative. A selected file needs its directory chain, never its siblings. */
export function deviceScopeMatcher(
  items: ShareItem[] | null,
  members: (item: ShareItem) => readonly string[]
): PathMatcher {
  if (items === null || items.some((item) => item.kind === 'vault')) return { ignores: () => false }
  const folders = new Set<string>(),
    files = new Set<string>(),
    ancestors = new Set<string>()
  const canonical = (path: string) => path.normalize('NFC').replace(/\/+$/, '')
  const add = (path: string, folder = false) => {
    path = canonical(path)
    ;(folder ? folders : files).add(path)
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) ancestors.add(parts.slice(0, i).join('/'))
  }
  for (const item of items) {
    add(item.path, item.kind === 'folder')
    if (item.kind === 'group') for (const path of members(item)) add(path)
  }
  return {
    ignores(path) {
      path = canonical(path)
      if (path === '' || ancestors.has(path) || files.has(path) || folders.has(path)) return false
      const parts = path.split('/')
      for (let i = 1; i < parts.length; i++)
        if (folders.has(parts.slice(0, i).join('/'))) return false
      return true
    },
  }
}
