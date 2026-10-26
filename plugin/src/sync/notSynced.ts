import { t } from '@/i18n'
/**
 * The files sync deliberately does not move, and why: one list for the connection window, grouped
 * by reason. Plain data, so the window stays small and each case can be tested.
 */

export type NotSyncedKind = 'too-large' | 'name' | 'held' | 'server' | 'waiting'

/**
 * Server answers that only make a file wait: it goes by itself once the server has room or
 * time again. Every other refusal needs the person, and only those are «not synced».
 */
const WAITING_CODES = new Set(['quota_exceeded', 'quota_waiting', 'rate_limited'])
export const waitingCode = (code: string | undefined): boolean =>
  code !== undefined && WAITING_CODES.has(code)
/** The same test for a stored reason, which starts with its code: `quota_waiting: …`. */
export const waitingReason = (reason: string): boolean => waitingCode(reason.split(':', 1)[0])

export interface NotSyncedItem {
  path: string
  kind: NotSyncedKind
  /** `out`: here, not sent. `in`: on the server, not placed here. */
  direction: 'out' | 'in'
  /** When it was first held back, ISO. */
  since: string
  /** One short fact for this file: its size, the character, what looked wrong. */
  fact?: string
  /** For a name this device cannot hold: the devices that have the file. */
  devices?: string[]
}

export interface NotSyncedGroup {
  kind: NotSyncedKind
  title: string
  /** What it means and what to do, once for the group. */
  desc: string
  items: NotSyncedItem[]
  /** Retrying makes sense: held and refused files may go once things change. */
  retry: boolean
}

const ORDER: NotSyncedKind[] = ['held', 'server', 'too-large', 'name', 'waiting']

/** What the person has to deal with, apart from what only waits; the window shows them apart. */
export function splitNotSynced(items: readonly NotSyncedItem[]): {
  refused: NotSyncedItem[]
  waiting: NotSyncedItem[]
} {
  return {
    refused: items.filter((item) => item.kind !== 'waiting'),
    waiting: items.filter((item) => item.kind === 'waiting'),
  }
}

export function groupNotSynced(items: NotSyncedItem[], _limit?: string): NotSyncedGroup[] {
  const text = {
    held: { title: t('sync.notSynced.heldTitle'), desc: t('sync.notSynced.heldDesc') },
    server: { title: t('sync.notSynced.serverTitle'), desc: t('sync.notSynced.serverDesc') },
    'too-large': { title: t('sync.notSynced.largeTitle'), desc: t('sync.notSynced.largeDesc') },
    name: { title: t('sync.notSynced.nameTitle'), desc: t('sync.notSynced.nameDesc') },
    waiting: { title: t('sync.notSynced.waitingTitle'), desc: t('sync.notSynced.waitingDesc') },
  }
  return ORDER.map((kind) => ({
    kind,
    ...text[kind],
    items: items.filter((item) => item.kind === kind),
    retry: kind === 'held' || kind === 'server' || kind === 'waiting',
  })).filter((group) => group.items.length)
}

/** A group longer than this starts folded, so one big reason does not bury the others. */
export const FOLD_OVER = 12
/** Rows drawn at a time inside a long group; the rest come as it is scrolled. */
export const PAGE = 50
