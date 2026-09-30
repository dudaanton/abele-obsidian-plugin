import { OperationDelays } from './deferred'

const copy = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value))

/** Plugin data.json boundary: values cross it by copy, and each I/O can be held or failed. */
export class FakeSettings {
  readonly delays = new OperationDelays<'load' | 'save'>()
  readonly saved: Array<Record<string, unknown>> = []
  constructor(public stored: unknown = null) {}

  async loadData(): Promise<unknown> {
    const wait = this.delays.take('load')
    if (wait) await wait
    return copy(this.stored)
  }

  async saveData(data: unknown): Promise<void> {
    const snapshot = copy(data) as Record<string, unknown>
    const wait = this.delays.take('save')
    if (wait) await wait
    this.saved.push(snapshot)
    this.stored = snapshot
  }

  syncAiFeatures(): void {}
}
