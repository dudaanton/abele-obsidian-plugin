import { expect, it } from 'vitest'
import { nativeControlFrame } from '../helpers/nativeControlFrame'

it('records fractional native screen arrays without an empty frame receipt', () => {
  expect(nativeControlFrame([392 + 2 / 3, 852])).toEqual({ width: 392 + 2 / 3, height: 852 })
})
it('retains only dimensions from an object frame', () => {
  expect(
    nativeControlFrame({ width: 393, height: 852, unrelated: 'sample' } as {
      width: number
      height: number
    })
  ).toEqual({ width: 393, height: 852 })
})
it.each([[[]], [[0, 852]], [[393, NaN]]])(
  'fails a missing or malformed frame rather than claiming conversion %j',
  (frame) => {
    expect(() => nativeControlFrame(frame)).toThrow(/frame is unavailable/)
  }
)
