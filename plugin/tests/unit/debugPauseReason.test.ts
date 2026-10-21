import { expect, it } from 'vitest'
import { pauseReason } from '@/debugger/pauseReason'

it('summarizes structured validation errors in the paused status', () => {
  expect(
    pauseReason(
      'ValidationError: [{"message":"Expected a number","path":["sample"]},{"message":"Required value","path":["other"]}]'
    )
  ).toBe('ValidationError: Expected a number; Required value')
})

it('retains ordinary errors and unrecognized diagnostics', () => {
  expect(pauseReason('SampleError: Missing value')).toBe('SampleError: Missing value')
  expect(pauseReason('SampleError: [not JSON]')).toBe('SampleError: [not JSON]')
  expect(pauseReason('SampleError: [{"code":"unknown"}]')).toBe('SampleError: [{"code":"unknown"}]')
})
