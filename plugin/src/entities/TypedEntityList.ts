import { reactive } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { acquireVaultNoteIndex } from './vaultNoteIndex'

/** Thin entity consumer of the shared index; entities retain their own content lifecycle. */
export class TypedEntityList<T extends { load(): unknown; cleanup(): void }> {
  protected readonly items = reactive(new Map()) as Map<string, T>
  private stop: (() => void) | null = null
  private release: (() => void) | null = null
  constructor(type: string, create: (path: string) => T) {
    const lease = acquireVaultNoteIndex(GlobalStore.getInstance().app, true)
    this.release = lease.release
    this.stop = lease.index.subscribeType(
      type,
      (path) => {
        if (this.items.has(path)) return
        const entity = create(path)
        entity.load()
        this.items.set(path, entity)
      },
      (path) => {
        this.items.get(path)?.cleanup()
        this.items.delete(path)
      }
    )
  }
  cleanup(): void {
    if (!this.release) return
    this.stop?.()
    for (const entity of this.items.values()) entity.cleanup()
    this.items.clear()
    this.release()
    this.stop = null
    this.release = null
  }
}
