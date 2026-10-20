/**
 * One token for a set: several folders, groups and single files given at once, and a set that
 * can change after it was given. What an item is, how it is named and drawn, which ones another
 * already covers, and what one item of a connection is doing, as a line and a dot.
 *
 * The set lives on the server; `shareSetSource` is what the screens read it through. Unset, a
 * connection is one scope as before and the Share dialog offers one folder or group.
 */
import { shallowRef } from 'vue'
import type { ServerDeleteFacts } from '@/components/sync/serverDelete'

export type ShareKind = 'vault' | 'folder' | 'group' | 'file'

export interface ShareItem {
  kind: ShareKind
  id: string
  /** Vault-relative: `/` for the vault, a folder's path, a group's or a file's note path. */
  path: string
}

/** A share holds this many items at most: each is its own exchange on every device. */
export const SHARE_LIMIT = 20

const base = (path: string) => path.split('/').pop() ?? path

/** The item as a list shows it: a folder's last segment, a note without `.md`. */
export function itemName(item: ShareItem): string {
  if (item.kind === 'vault') return 'Whole vault'
  const name = base(item.path)
  return item.kind === 'folder' ? name : name.replace(/\.md$/i, '')
}

/** Where the item lies, quiet beside its name; nothing for the vault or the vault's top. */
export function itemPlace(item: ShareItem): string {
  if (item.kind === 'vault') return ''
  const parts = item.path.split('/')
  return parts.slice(0, -1).join('/')
}

/** The kind as a glyph: folder, group, note or file, the vault. */
export function itemGlyph(item: ShareItem): string {
  if (item.kind === 'vault') return 'vault'
  if (item.kind === 'folder') return 'folder'
  if (item.kind === 'group') return 'group'
  return /\.md$/i.test(item.path) ? 'file-text' : 'file'
}

/** The item in a sentence: “Folder: Garden”, “Group: Reading circle”, “File: Plum jam”. */
export function itemLabel(item: ShareItem): string {
  if (item.kind === 'vault') return 'Whole vault'
  const kind = { folder: 'Folder', group: 'Group', file: 'File' }[item.kind]
  return `${kind}: ${itemName(item)}`
}

/** A set's name where it has none of its own: its first item and how many more. */
export function setTitle(items: ShareItem[], label?: string | null): string {
  if (label?.trim()) return label.trim()
  if (!items.length) return 'Nothing shared'
  const first = itemLabel(items[0]).replace(': ', ' ')
  return items.length > 1 ? `${first} + ${items.length - 1}` : first
}

/** The item among `items` that already holds this one: the vault, or a folder above it. */
export function coveredBy(item: ShareItem, items: ShareItem[]): ShareItem | null {
  for (const one of items) {
    if (one.id === item.id) continue
    if (one.kind === 'vault') return one
    if (one.kind === 'folder' && item.kind !== 'group' && item.path.startsWith(one.path + '/'))
      return one
  }
  return null
}

/** A token given: its name, its set, whether it may change things, and whether it still works. */
export interface IssuedShare {
  id: string
  label: string
  items: ShareItem[]
  readOnly: boolean
  createdAt: string
  revokedAt: string | null
}

/** What one item of a connection is doing on this device. */
export type ItemState =
  | { kind: 'synced'; at?: number }
  | { kind: 'syncing'; completed: number; total: number }
  | { kind: 'paused' }
  | { kind: 'moved'; to: string }
  | { kind: 'error'; reason: string }
  /** Taken out of the share by whoever gave it: nothing more comes, the copy here stays. */
  | { kind: 'detached' }

export interface ConnectionItem extends ShareItem {
  state: ItemState
  /** Files of it on this device, and how many of those were changed here. */
  files?: number
  edited?: number
}

export type ItemTone = 'green' | 'orange' | 'red' | 'accent' | 'faint'

export function itemTone(state: ItemState): ItemTone {
  switch (state.kind) {
    case 'synced':
      return 'green'
    case 'syncing':
      return 'accent'
    case 'paused':
    case 'moved':
      return 'orange'
    case 'error':
      return 'red'
    case 'detached':
      return 'faint'
  }
}

const n = (value: number) => value.toLocaleString('en').replace(/,/g, ' ')

/** One line under the item's name: what it is doing, or what it waits on. */
export function itemLine(state: ItemState): string {
  switch (state.kind) {
    case 'synced':
      return 'Synced'
    case 'syncing':
      return `Receiving ${n(state.completed)} of ${n(state.total)}`
    case 'paused':
      return 'Paused on this device'
    case 'moved':
      return `Moved on the server to ${state.to}`
    case 'error':
      return state.reason
    case 'detached':
      return 'No longer shared · copy kept'
  }
}

const RANK: ItemTone[] = ['faint', 'green', 'accent', 'orange', 'red']

/** The set's dot: the worst of its items, a detached one counting for nothing. */
export function setTone(items: ConnectionItem[]): ItemTone {
  return items
    .map((one) => itemTone(one.state))
    .reduce<ItemTone>(
      (worst, tone) => (RANK.indexOf(tone) > RANK.indexOf(worst) ? tone : worst),
      'faint'
    )
}

/** The set's line: the connection's own while every item is well, else how many are not. */
export function setLine(items: ConnectionItem[], line: string): string {
  const red = items.filter((one) => itemTone(one.state) === 'red').length
  if (red) return `${red} of ${items.length} need${red === 1 ? 's' : ''} attention`
  const orange = items.filter((one) => itemTone(one.state) === 'orange').length
  if (orange) return `${orange} of ${items.length} waiting`
  return line
}

/** What reading a token says before connecting: the set as it is now, and whether it may write. */
export interface SharePreview {
  items: ShareItem[]
  readOnly: boolean
}

/**
 * What the screens ask about sets. Production reads the server's item routes; the design stand
 * sets a fake one.
 */
export interface ShareSetSource {
  /** The server keeps sets; otherwise the dialogs stay as they were, one scope per token. */
  several: (connectionId?: string) => boolean
  /** The connection's set on this device, or null for a connection of one scope. */
  items: (connectionId: string) => ConnectionItem[] | null
  label: (connectionId: string) => string | null
  /** This device gave the token: it may delete from the server. */
  owner: (connectionId: string) => boolean
  choices: (connectionId?: string) => ShareItem[]
  shares: (connectionId?: string) => Promise<IssuedShare[]>
  issue: (
    connectionId: string | undefined,
    set: { items: ShareItem[]; label: string; readOnly: boolean }
  ) => Promise<string>
  add: (connectionId: string | undefined, shareId: string, items: ShareItem[]) => Promise<void>
  remove: (connectionId: string | undefined, shareId: string, itemId: string) => Promise<void>
  revoke: (connectionId: string | undefined, shareId: string) => Promise<void>
  preview: (token: string) => SharePreview | null
  pauseItem: (connectionId: string, itemId: string, paused: boolean) => Promise<void>
  followItem: (connectionId: string, itemId: string) => Promise<void>
  removeCopy: (connectionId: string, itemId: string) => Promise<void>
  /** What deleting one item of a share, or the whole share when `itemId` is null, would take. */
  deleteFacts: (shareId: string, itemId: string | null) => ShareDeleteFacts | null
  deleteFromServer: (shareId: string, itemId: string | null) => Promise<void>
}

/** The server's facts for deleting, and the notes that other shared groups hold as well. */
export interface ShareDeleteFacts extends ServerDeleteFacts {
  also?: { path: string; group: string }[]
}

/** Set once the server answers for sets (or by the design stand); null keeps the old screens. */
export const shareSetSource = shallowRef<ShareSetSource | null>(null)
