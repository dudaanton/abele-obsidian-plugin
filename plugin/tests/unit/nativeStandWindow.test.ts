// @vitest-environment node
import { it, expect, vi } from 'vitest'
import { ensureOwnedPoolWindow } from '../../scripts/agent-stand-window.mjs'
it('opens a closed owned pool under the app gate before reload, then returns it closed', () => {
  const probe = vi.fn().mockReturnValueOnce(false).mockReturnValue(true),
    open = vi.fn(),
    close = vi.fn(),
    gate = vi.fn((fn) => fn())
  const dispose = ensureOwnedPoolWindow({ probe, open, close, gate })
  expect(gate).toHaveBeenCalledTimes(1)
  expect(open).toHaveBeenCalledOnce()
  dispose()
  expect(close).toHaveBeenCalledOnce()
  expect(gate).toHaveBeenCalledTimes(2)
})
it('never closes or opens a window that was already open', () => {
  const open = vi.fn(),
    close = vi.fn()
  ensureOwnedPoolWindow({ probe: () => true, open, close, gate: (fn) => fn() })()
  expect(open).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})
