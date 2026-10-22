import { Chunk } from '@codemirror/merge'
import { Text } from '@codemirror/state'

export interface OverviewChange {
  from: number
  to: number
  kind: 'added' | 'removed' | 'changed'
}

export function overviewChanges(original: string, working: string): OverviewChange[] {
  const before = Text.of(original.split('\n'))
  const after = Text.of(working.split('\n'))
  return Chunk.build(before, after).map((chunk) => ({
    from: after.lineAt(Math.min(chunk.fromB, after.length)).number,
    to: after.lineAt(Math.min(Math.max(chunk.fromB, chunk.toB - 1), after.length)).number,
    kind: chunk.fromA === chunk.toA ? 'added' : chunk.fromB === chunk.toB ? 'removed' : 'changed',
  }))
}

export function overviewLine(fraction: number, lines: number): number {
  return Math.max(1, Math.min(lines, 1 + Math.floor(fraction * lines)))
}
