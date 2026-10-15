import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasSession, CanvasSessionError } from '../../src/canvas/core/session'
import { CanvasWriteScheduler } from '../../src/canvas/core/writeScheduler'
import type { CanvasGraph } from '../../src/canvas/core/model'

const card = (x = 0): CanvasGraph => ({
  nodes: [{ id: 'sample-card', type: 'text', text: 'Sample', x, y: 0, width: 100, height: 80 }],
  edges: [],
})
const moveTo = (x: number) => (graph: CanvasGraph) => ({
  ...graph,
  nodes: graph.nodes.map((n) => ({ ...n, x })),
})
function step(session: CanvasSession, x: number) {
  session.beginDraft()
  session.updateDraft(moveTo(x))
  session.finishDraft()
}
function write(session: CanvasSession, revision: string) {
  const token = session.prepareDraft()
  const graph = session.apply(token, session.committed)
  return () => session.acknowledge(token, { graph, revision })
}
const x = (graph: CanvasGraph) => graph.nodes[0].x

describe('local canvas steps', () => {
  it('records each finished draft as its own step and writes them as one batch', () => {
    const session = new CanvasSession({ graph: card(), revision: 'r0' })
    step(session, 10)
    step(session, 20)
    step(session, 30)
    expect(session.history).toEqual({ undo: 0, redo: 0 })
    expect(session.localHistory).toEqual({ undo: 3, redo: 0 })
    write(session, 'r1')()
    expect(session.history).toEqual({ undo: 3, redo: 0 })
    expect(session.dirty).toBe(false)
    expect(x(session.committed.graph)).toBe(30)
  })
  it('undoes and redoes in memory before anything is written, and writes the result', () => {
    const session = new CanvasSession({ graph: card(), revision: 'r0' })
    step(session, 10)
    step(session, 20)
    session.undoLocal()
    expect(x(session.graph)).toBe(10)
    session.undoLocal()
    expect(x(session.graph)).toBe(0)
    session.redoLocal()
    expect(x(session.graph)).toBe(10)
    expect(session.localHistory).toEqual({ undo: 1, redo: 1 })
    write(session, 'r1')()
    expect(session.history).toEqual({ undo: 1, redo: 1 })
    expect(x(session.committed.graph)).toBe(10)
    session.undoLocal()
    expect(x(session.graph)).toBe(0)
    write(session, 'r2')()
    expect(session.history).toEqual({ undo: 0, redo: 2 })
  })
  it('a written step undoes in memory too', () => {
    const session = new CanvasSession({ graph: card(), revision: 'r0' })
    step(session, 10)
    write(session, 'r1')()
    session.undoLocal()
    expect(x(session.graph)).toBe(0)
    expect(() => session.undoLocal()).toThrow(CanvasSessionError)
  })
  it('keeps editing while its own write is in flight; later steps stay pending on what it wrote', () => {
    const session = new CanvasSession({ graph: card(), revision: 'r0' })
    step(session, 10)
    const land = write(session, 'r1')
    expect(session.writing).toBe(true)
    step(session, 20)
    session.beginDraft()
    session.updateDraft(moveTo(30))
    land()
    expect(x(session.committed.graph)).toBe(10)
    expect(session.draft?.active).toBe(true)
    expect(session.localHistory).toEqual({ undo: 2, redo: 0 })
    // The write leaves the active draft out.
    write(session, 'r2')()
    expect(x(session.committed.graph)).toBe(20)
    session.finishDraft()
    write(session, 'r3')()
    expect(x(session.committed.graph)).toBe(30)
    expect(session.history).toEqual({ undo: 3, redo: 0 })
  })
  it('does not let local edits start during a write that is not the local draft', () => {
    const session = new CanvasSession({ graph: card(), revision: 'r0' })
    const token = session.prepare(moveTo(50))
    session.apply(token, session.committed)
    expect(() => session.beginDraft()).toThrow(/busy/)
    expect(() => session.undoLocal()).toThrow(/busy/)
  })
  it('cancelling a gesture drops only that gesture', () => {
    const session = new CanvasSession({ graph: card(), revision: 'r0' })
    step(session, 10)
    session.beginDraft()
    session.updateDraft(moveTo(99))
    session.cancelDraft()
    expect(x(session.graph)).toBe(10)
    expect(session.localHistory.undo).toBe(1)
    session.undoLocal()
    session.redoLocal()
    session.undoLocal()
    // Back where the file is: nothing is left to write, nor any preview.
    expect(x(session.graph)).toBe(0)
  })
  it('retains every step behind an unknown write and refuses new ones until reviewed', () => {
    const session = new CanvasSession({ graph: card(), revision: 'r0' })
    step(session, 10)
    const token = session.prepareDraft()
    session.apply(token, session.committed)
    step(session, 20)
    session.quarantine(token, 'unknown')
    expect(session.publicationOutcome).toBe('unknown')
    expect(x(session.graph)).toBe(20)
    expect(x(session.committed.graph)).toBe(0)
    expect(() => session.beginDraft()).toThrow(/conflict/)
    session.discardPublication(session.publicationAttempt!, session.generation)
    expect(session.dirty).toBe(false)
    expect(session.localHistory).toEqual({ undo: 0, redo: 0 })
  })
  it('keeps every step after a write known not to happen, and writes them on retry', () => {
    const session = new CanvasSession({ graph: card(), revision: 'r0' })
    step(session, 10)
    step(session, 20)
    const token = session.prepareDraft()
    session.reject(token)
    expect(session.localHistory.undo).toBe(2)
    write(session, 'r1')()
    expect(session.history.undo).toBe(2)
  })
})

describe('batched canvas writes', () => {
  afterEach(() => vi.useRealTimers())
  const timers = {
    set: (run: () => void, ms: number) => setTimeout(run, ms) as unknown as number,
    clear: (id: number) => clearTimeout(id),
  }
  const scheduler = (pending: { value: boolean }, write = vi.fn(async () => {})) => {
    const failed = vi.fn()
    const s = new CanvasWriteScheduler<string>(
      {
        pending: () => pending.value,
        write: async (d) => {
          await write(d)
          pending.value = false
        },
        failed,
      },
      timers,
      { idle: 100, max: 300 }
    )
    return { s, write, failed }
  }
  it('writes after a pause, once for many changes', async () => {
    vi.useFakeTimers()
    const pending = { value: true },
      { s, write } = scheduler(pending)
    for (let i = 0; i < 5; i++) {
      s.changed('doc')
      await vi.advanceTimersByTimeAsync(50)
    }
    expect(write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(write).toHaveBeenCalledOnce()
  })
  it('writes at the latest after the longest wait while changes keep coming', async () => {
    vi.useFakeTimers()
    const pending = { value: true },
      { s, write } = scheduler(pending)
    for (let i = 0; i < 7; i++) {
      s.changed('doc')
      await vi.advanceTimersByTimeAsync(50)
    }
    expect(write).toHaveBeenCalledOnce()
  })
  it('flushes at once, and reports a failed write without retrying it by itself', async () => {
    const pending = { value: true },
      error = new Error('Sample storage failure'),
      { s, write, failed } = scheduler(
        pending,
        vi.fn(async () => {
          throw error
        })
      )
    s.changed('doc')
    expect(await s.flush()).toBe(false)
    expect(failed).toHaveBeenCalledWith('doc', error)
    await new Promise((r) => setTimeout(r, 150))
    expect(write).toHaveBeenCalledOnce()
  })
  it('waits for a write in flight and then writes what came during it', async () => {
    let batches = 1
    const write = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20))
      // A change made while this batch was being written.
      if (write.mock.calls.length === 1) batches++
      batches--
    })
    const s = new CanvasWriteScheduler<string>(
      { pending: () => batches > 0, write, failed: vi.fn() },
      timers,
      { idle: 100, max: 300 }
    )
    const first = s.flush('doc'),
      second = s.flush('doc')
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(write).toHaveBeenCalledTimes(2)
    expect(batches).toBe(0)
  })
  it('stops its timer on dispose', async () => {
    vi.useFakeTimers()
    const pending = { value: true },
      { s, write } = scheduler(pending)
    s.changed('doc')
    s.dispose()
    await vi.advanceTimersByTimeAsync(1000)
    expect(write).not.toHaveBeenCalled()
  })
})
