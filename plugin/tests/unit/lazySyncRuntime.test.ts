import { expect, it, vi } from 'vitest'

it('does not evaluate the exchange runtime just to import connection controls', async () => {
  const evaluated = vi.fn()
  vi.doMock('@/sync/tokenEngineRuntime', async (original) => {
    evaluated()
    return original()
  })
  try {
    await import('@/sync/tokenEngines')
    expect(evaluated).not.toHaveBeenCalled()
  } finally {
    vi.doUnmock('@/sync/tokenEngineRuntime')
  }
})
