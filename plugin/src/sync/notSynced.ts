import { t } from '@/i18n'
/**
 * The files sync deliberately does not move, and why: one list for the connection window, grouped
 * by reason. Plain data, so the window stays small and each case can be tested.
 */

export type NotSyncedKind = 'too-large' | 'name' | 'held' | 'server'

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

const ORDER: NotSyncedKind[] = ['held', 'server', 'too-large', 'name']

export function groupNotSynced(items: NotSyncedItem[], _limit?: string): NotSyncedGroup[] {
  const text = {
    held: { title: t('sync.notSynced.heldTitle'), desc: t('sync.notSynced.heldDesc') },
    server: { title: t('sync.notSynced.serverTitle'), desc: t('sync.notSynced.serverDesc') },
    'too-large': { title: t('sync.notSynced.largeTitle'), desc: t('sync.notSynced.largeDesc') },
    name: { title: t('sync.notSynced.nameTitle'), desc: t('sync.notSynced.nameDesc') },
  }
  return ORDER.map((kind) => ({
    kind,
    ...text[kind],
    items: items.filter((item) => item.kind === kind),
    retry: kind === 'held' || kind === 'server',
  })).filter((group) => group.items.length)
}

/** A group longer than this starts folded, so one big reason does not bury the others. */
export const FOLD_OVER = 12
/** Rows drawn at a time inside a long group; the rest come as it is scrolled. */
export const PAGE = 50
