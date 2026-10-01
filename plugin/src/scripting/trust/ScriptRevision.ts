import { caseKey } from '@abele/sync-protocol'

/** Single-runtime path fence shared by every provenance connection for a physical vault. */
export class ScriptRevision {
  private readonly paths = new Map<string, { generation: number; pending: number }>()
  private state(path: string) {
    const key = caseKey(path)
    let state = this.paths.get(key)
    if (!state) {
      state = { generation: 0, pending: 0 }
      this.paths.set(key, state)
    }
    return state
  }
  begin(paths: string[]): () => void {
    const states = [...new Set(paths.map(caseKey))].map((path) => this.state(path))
    for (const state of states) {
      state.generation++
      state.pending++
    }
    return () => {
      for (const state of states) state.pending--
    }
  }
  capture(path: string): number {
    const state = this.state(path)
    if (state.pending) throw new Error('Script provenance changed; mutation is pending')
    return state.generation
  }
  assert(path: string, expected: number): void {
    if (this.capture(path) !== expected)
      throw new Error('Script provenance changed during the execution check')
  }
}
