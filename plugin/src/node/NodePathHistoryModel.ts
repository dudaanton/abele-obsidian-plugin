import { ref, shallowRef, markRaw } from 'vue'
import type { RepositoryRevision } from '@abele/node-protocol'
import type { CommitSummary } from '@/components/nodeWork/types'
import type { NodePathPort, PathTarget } from './NodePathModel'

/** A history tab stays on its own target and frozen tip, even as the drawer changes. */
export class NodePathHistoryModel {
  readonly commits = shallowRef<CommitSummary[]>([])
  readonly openCommit = ref('')
  readonly cursor = ref<string | null>(null)
  readonly busy = ref(false)
  readonly error = ref('')
  private revision?: RepositoryRevision
  private generation = 0
  constructor(
    readonly port: NodePathPort,
    readonly target: PathTarget
  ) {
    this.target = Object.freeze({ ...target })
    markRaw(this)
  }
  async load(more = false): Promise<void> {
    const generation = ++this.generation
    this.busy.value = true
    try {
      const page = await this.port.history(
        this.target,
        more ? (this.cursor.value ?? undefined) : undefined,
        more ? this.revision : undefined
      )
      if (generation !== this.generation) return
      this.commits.value = more
        ? [
            ...this.commits.value,
            ...page.entries.filter((c) => !this.commits.value.some((old) => old.hash === c.hash)),
          ]
        : page.entries
      this.cursor.value = page.cursor
      this.revision = page.revision
      this.error.value = ''
    } catch (error) {
      if (generation === this.generation)
        this.error.value = error instanceof Error ? error.message : 'Could not load history'
      throw error
    } finally {
      if (generation === this.generation) this.busy.value = false
    }
  }
  async open(hash: string): Promise<void> {
    const generation = ++this.generation
    this.busy.value = true
    try {
      const commit = await this.port.commit(this.target, hash)
      if (generation !== this.generation) return
      this.commits.value = this.commits.value.some((c) => c.hash === hash)
        ? this.commits.value.map((c) => (c.hash === hash ? commit : c))
        : [...this.commits.value, commit]
      this.openCommit.value = hash
      this.error.value = ''
    } catch (error) {
      if (generation === this.generation)
        this.error.value = error instanceof Error ? error.message : 'Could not load commit'
      throw error
    } finally {
      if (generation === this.generation) this.busy.value = false
    }
  }
  back(): void {
    ++this.generation
    this.busy.value = false
    this.openCommit.value = ''
  }
  destroy(): void {
    ++this.generation
  }
}
