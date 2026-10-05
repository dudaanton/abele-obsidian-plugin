import { expect, it } from 'vitest'
import { manualControlReady, type ManualControlWitness } from '../helpers/manualControlReady'
import { manualKeyConsentProbe } from '../helpers/manualKeyConsentProbe'

/** Extracts the actual consumer sampler, not a separate duplicate of its viewport arithmetic. */
function sampleAt(innerHeight: number, visualHeight: number, nativeKeyboard: number) {
  const code = manualKeyConsentProbe('/sample', 'sample-token', true)
  const start = code.indexOf('    const sample=')
  const end = code.indexOf('    s.prepare=', start)
  const source = code.slice(start, end) + 'return sample'
  const control = {
    parentElement: null,
    getBoundingClientRect: () => ({
      left: 20,
      right: 120,
      top: 20,
      bottom: 60,
      width: 100,
      height: 40,
    }),
  }
  const doc = { activeElement: control, documentElement: {} }
  const s = {
    physical: true,
    modal: { modalEl: control },
    events: [
      { type: 'touchstart', trusted: true, matched: true },
      { type: 'focusin', trusted: true, matched: true, focused: true },
    ],
    baseline: { innerHeight: 800, visualTop: 0, visualHeight: 800 },
  }
  const sampler = new Function(
    's',
    'fullHeight',
    'innerHeight',
    'visualViewport',
    'getComputedStyle',
    'rect',
    'keyboard',
    'shadowReach',
    'primary',
    'document',
    source
  )(
    s,
    852,
    innerHeight,
    { offsetTop: 0, offsetLeft: 0, height: visualHeight, width: 393 },
    () => ({ boxShadow: 'none', outlineStyle: 'none' }),
    (el: any) => el.getBoundingClientRect(),
    () => nativeKeyboard,
    () => 0,
    () => control,
    doc
  )
  return sampler(
    { label: 'Sample input', kind: 'editable', control },
    true
  ) as ManualControlWitness & { keyboard: number }
}

it('rejects static screen852/viewport800 inset with native keyboard zero in the actual sampler', () => {
  const sample = sampleAt(800, 800, 0)
  expect(sample.keyboard).toBe(0)
  expect(manualControlReady(sample)).toBe(false)
})
it('rejects the static-inset witness in the physical readiness predicate too', () => {
  expect(manualControlReady(sampleAt(800, 800, 0))).toBe(false)
})
it('keeps native height independent when the viewport does not shrink', () => {
  const sample = sampleAt(800, 800, 335)
  expect(sample.keyboard).toBe(335)
  expect(manualControlReady(sample)).toBe(true)
})
it('accepts a real reduction from captured keyboard-free viewport rather than screen height', () => {
  const sample = sampleAt(800, 500, 0)
  expect(sample.keyboard).toBe(300)
  expect(manualControlReady(sample)).toBe(true)
})
