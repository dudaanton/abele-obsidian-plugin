import { expect, it } from 'vitest'
import { breakpointCapabilities } from '@/debugger/breakpointCapabilities'

it.each([
  undefined,
  {},
  { capabilities: { capabilities: { debugger_v1: { status: 'supported' } } } },
])('keeps old-node breakpoint fallbacks without explicit support', (description) => {
  expect(breakpointCapabilities(description)).toEqual({
    breakpoint_enabled: false,
    breakpoint_hit_condition: false,
  })
})
it('reads only the advertised supported debugger capabilities', () => {
  const capability = {
    status: 'supported',
    breakpoint_enabled: true,
    breakpoint_hit_condition: true,
  }
  expect(
    breakpointCapabilities({ capabilities: { capabilities: { debugger_v1: capability } } })
  ).toEqual({ breakpoint_enabled: true, breakpoint_hit_condition: true })
  expect(
    breakpointCapabilities({
      capabilities: { capabilities: { debugger_v1: { ...capability, status: 'unsupported' } } },
    })
  ).toEqual({ breakpoint_enabled: false, breakpoint_hit_condition: false })
})
