import { expect, it, vi } from 'vitest'
import { rawStackNames } from '../helpers/rawStackNames'

it('identifies the refresh caller without formatting source-mapped stacks inside the measurement', () => {
  const original = Error.prepareStackTrace
  const format = vi.fn(() => 'formatted diagnostic')
  function refreshLocalPaths() {
    return rawStackNames()
  }
  try {
    Error.prepareStackTrace = format
    expect(refreshLocalPaths()).toContain('refreshLocalPaths')
    expect(format).not.toHaveBeenCalled()
  } finally {
    Error.prepareStackTrace = original
  }
})
