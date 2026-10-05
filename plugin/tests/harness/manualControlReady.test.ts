import { expect, it } from 'vitest'
import { manualControlReady, type ManualControlWitness } from '../helpers/manualControlReady'
import { settledGeometry } from '../helpers/settledGeometry'

const witness = (extra: Partial<ManualControlWitness> = {}): ManualControlWitness => ({
  kind: 'editable',
  physical: true,
  focused: true,
  nativeKeyboard: 0,
  fullHeight: 844,
  baselineInnerHeight: 844,
  baselineVisualHeight: 844,
  innerHeight: 844,
  visualTop: 0,
  visualHeight: 844,
  acknowledged: true,
  initialTarget: true,
  trustedFocus: true,
  ...extra,
})

it('does not accept stable actual focus with no visible software keyboard on a physical input', () => {
  expect(manualControlReady(witness())).toBe(false)
})
it('keeps stable focus/keyboard-zero red even after the geometry quiet interval', async () => {
  let at = 0
  await expect(
    settledGeometry(
      () => witness(),
      async () => {
        at += 50
      },
      () => at,
      500,
      400,
      manualControlReady
    )
  ).rejects.toThrow(/geometry/i)
  expect(at).toBe(500)
})
it.each([{ nativeKeyboard: 336 }, { visualHeight: 508 }, { innerHeight: 508, visualHeight: 508 }])(
  'accepts actual native or shrinking-viewport software keyboard evidence %j',
  (extra) => {
    expect(manualControlReady(witness(extra))).toBe(true)
  }
)
it.each([
  { focused: false },
  { acknowledged: false },
  { initialTarget: false },
  { trustedFocus: false },
])('rejects missing native delivery/focus evidence %j', (extra) => {
  expect(manualControlReady(witness({ nativeKeyboard: 336, ...extra }))).toBe(false)
})
it('does not require a software keyboard for desktop editing or noneditable focus', () => {
  expect(manualControlReady(witness({ physical: false }))).toBe(true)
  expect(manualControlReady(witness({ kind: 'noneditable' }))).toBe(true)
})
it('does not fabricate focus on a native sizing copy', () => {
  expect(manualControlReady(witness({ kind: 'sizing-copy', focused: false }))).toBe(true)
})
it('does not treat acknowledgment or later BODY click as the delivery witness', () => {
  expect(manualControlReady(witness({ nativeKeyboard: 336, initialTarget: false }))).toBe(false)
  // A later retargeted click does not erase the original trusted input/focus delivery.
  expect(
    manualControlReady({
      ...witness({ nativeKeyboard: 336 }),
      laterClickTarget: 'BODY',
    } as ManualControlWitness)
  ).toBe(true)
})
