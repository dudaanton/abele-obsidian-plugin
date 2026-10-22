import { inject, shallowRef, type InjectionKey, type ShallowRef } from 'vue'
import type { ToolMode } from '@/ai/types'

/**
 * The chats as a tree: folders, the chats in them, and under a chat what was opened from it —
 * a discussion, a helper, work on a node, a chat it wrote to. Folders are synced logical
 * entities; their access only adds to what the default and agent already give.
 */

/** Where a chat stands, as its dot says: waiting for you, at work, or failed. */
export type ChatTreeState = 'waiting' | 'working' | 'failed'

/** What a nested chat is to the one it was opened from: drawn by its glyph. */
export type ChatTreeKind = 'chat' | 'discussion' | 'helper' | 'node'

export interface ChatTreeChat {
  kind: 'chat'
  id: string
  /** Stable transcript identity for device-local folds, including closed chats. */
  foldId?: string
  title: string
  /** Has a tab now; a closed chat is still in its folder, under «Closed». */
  open: boolean
  /** What it is to the chat above it; a chat of its own when at the top of a folder. */
  nested?: ChatTreeKind
  state?: ChatTreeState
  /** Why it is in that state, for the dot's tooltip («Waiting for Firmware docs to answer»). */
  stateNote?: string
  /** The last message, epoch ms. */
  at: number
  /** Chats opened from it, under it. */
  children?: ChatTreeChat[]
}

export interface ChatTreeFolder {
  kind: 'folder'
  /** The logical display path; membership uses the folder's stable id. */
  path: string
  name: string
  /** Tools this folder raises for its chats above the default, by permission key. */
  access?: Record<string, ToolMode>
  children: ChatTreeEntry[]
  canDelete?: boolean
}

export type ChatTreeEntry = ChatTreeFolder | ChatTreeChat

/** What drives the tree: the plugin's chat service, or a prototype's made-up chats. */
export interface ChatTreeSource {
  refresh?(): Promise<void>
  /** The whole tree, folders first; reactive. */
  readonly root: { readonly value: ChatTreeEntry[] }
  readonly activeId: { readonly value: string | null }
  /** Changes on selection, even while the tree is closed; zero is a restored selection. */
  readonly selectionVersion?: { readonly value: number }
  open(id: string): void
  close(id: string): void
  /** `folder` is a folder's path, '' for the top. */
  move(id: string, folder: string): void
  newChat(folder: string): void
  newFolder(parent: string, name: string): void
  renameFolder(path: string, name: string): void
  deleteFolder(path: string): void
  /** Opens the folder's access, the tools its chats get on top of the default. */
  folderAccess(path: string): void
  rename(id: string): void
  delete(id: string): void
}

/** Set by whatever shows chats as a tree; the chat's tab strip stays while it is null. */
export const chatTreeSource = shallowRef<ChatTreeSource | null>(null)
export const CHAT_TREE_SOURCE: InjectionKey<ShallowRef<ChatTreeSource | null>> =
  Symbol('chat-tree-source')
export const useChatTreeSource = () => inject(CHAT_TREE_SOURCE, chatTreeSource)

/** Every chat in the tree, nested ones included, depth first. */
export function chatsOf(entries: readonly ChatTreeEntry[]): ChatTreeChat[] {
  return entries.flatMap((e) =>
    e.kind === 'folder' ? chatsOf(e.children) : [e, ...chatsOf(e.children ?? [])]
  )
}

/** The folders on the way to a chat, outermost first; empty at the top. */
export function folderPathOf(entries: readonly ChatTreeEntry[], id: string): ChatTreeFolder[] {
  for (const e of entries) {
    if (e.kind === 'folder') {
      const inner = folderPathOf(e.children, id)
      if (inner.length || chatsOf(e.children).some((c) => c.id === id)) return [e, ...inner]
    }
  }
  return []
}

/** Every folder, nested ones included, for a picker. */
export function foldersOf(entries: readonly ChatTreeEntry[]): ChatTreeFolder[] {
  return entries.flatMap((e) => (e.kind === 'folder' ? [e, ...foldersOf(e.children)] : []))
}

const RANK: Record<ToolMode, number> = { off: 0, ask: 1, auto: 2 }

/**
 * A chat's tool modes with its folders' added: each folder may only raise a tool, never lower
 * it. Returns the modes and, for each tool a folder raised, that folder's name.
 */
export function withFolderAccess(
  base: Record<string, ToolMode>,
  folders: readonly ChatTreeFolder[]
): { modes: Record<string, ToolMode>; raisedBy: Record<string, string> } {
  const modes = { ...base }
  const raisedBy: Record<string, string> = {}
  for (const folder of folders)
    for (const [key, mode] of Object.entries(folder.access ?? {}))
      if (RANK[mode] > RANK[modes[key] ?? 'off']) {
        modes[key] = mode
        raisedBy[key] = folder.name
      }
  return { modes, raisedBy }
}

/** Whether `mode` is below `floor`: what a folder cannot choose. */
export const below = (mode: ToolMode, floor: ToolMode | undefined) =>
  RANK[mode] < RANK[floor ?? 'off']
