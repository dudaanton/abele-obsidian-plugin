import { watch } from 'vue'
import { tokenUi } from './tokenUi'

export function isFullySynced(): boolean {
  return !(tokenUi.value?.rows.value ?? []).some(
    (row) => row.status === 'syncing' || row.status === 'joining'
  )
}
export function onStatusChange(callback: () => void): () => void {
  return watch(isFullySynced, callback, { flush: 'sync' })
}
