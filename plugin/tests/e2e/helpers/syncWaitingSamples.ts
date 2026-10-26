import type { NotSyncedItem } from '@/sync/notSynced'

/** Shared by the renderer screenshot and its metadata regression check. */
export const heldPlacementSample = (since: string): NotSyncedItem => ({
  path: 'Research/Field notes/Map reference.pdf',
  kind: 'held',
  direction: 'in',
  since,
  fact: 'changed while it was being placed',
})
