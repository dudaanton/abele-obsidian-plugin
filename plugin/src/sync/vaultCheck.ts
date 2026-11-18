/**
 * Checking the vault against the server: every file here compared with the server's copy by its
 * content, not by what sync believes it sent. The answer is either that everything matches or
 * a list of what differs and why. The check reads only; it changes and deletes nothing.
 *
 * This file is the screen's side: the states it draws and what its buttons ask for. The
 * comparison itself lives in the engine and is not reached from here, so the same screen can
 * be shown on made-up data.
 */
import { shallowRef, type Ref } from 'vue'

/** Why a file did not match, in the order the window lists them: the expected first. */
export type VaultCheckReason = 'unsent' | 'skipped' | 'differs' | 'server-only' | 'local-only'

export const REASON_ORDER: VaultCheckReason[] = [
  'unsent',
  'skipped',
  'differs',
  'server-only',
  'local-only',
]

export interface VaultCheckItem {
  path: string
  reason: VaultCheckReason
  /** A short fact beside the folder: the rule's name, two sizes. */
  fact?: string
}

export type VaultCheckState =
  | { kind: 'never' }
  | {
      kind: 'running'
      done: number
      total: number
      bytesDone: number
      bytesTotal: number
      current?: string
    }
  | { kind: 'matched'; total: number; bytes: number; at: number }
  | { kind: 'differs'; total: number; bytes: number; at: number; items: VaultCheckItem[] }
  | { kind: 'stopped'; done: number; total: number; at: number }
  | { kind: 'unreachable'; at: number }

export interface VaultCheckSource {
  state: Ref<VaultCheckState>
  start: () => void
  stop: () => void
  /** Sends one file that was changed here after its last upload. */
  send: (path: string) => Promise<void>
}

/** Set by the plugin for the open connection, or by a design stand. */
export const vaultCheckSource = shallowRef<VaultCheckSource | null>(null)
