import type { NodeLogEntry } from './NodeLogModel'
interface Snapshot {
  authority: number
  lines: NodeLogEntry[]
  version: string
}
/** Bounded, connection-local snapshots for reopening the owner log while offline. */
export class NodeLogSnapshots {
  private values = new WeakMap<object, Snapshot>()
  remember(connection: object, authority: number, lines: NodeLogEntry[], version: string): void {
    this.values.set(connection, {
      authority,
      lines: lines.slice(-200).map((line) => ({ ...line })),
      version,
    })
  }
  read(
    connection: object,
    authority: number
  ): { lines: NodeLogEntry[]; version: string } | undefined {
    const value = this.values.get(connection)
    if (!value || value.authority !== authority) return undefined
    return { lines: value.lines.map((line) => ({ ...line })), version: value.version }
  }
}
