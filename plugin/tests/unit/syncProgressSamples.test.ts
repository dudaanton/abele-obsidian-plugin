import { expect, it } from 'vitest'
import { syncProgressSamples } from '../e2e/helpers/syncProgressSamples'

it('samples the real numeric progress label after serialization into the browser', () => {
  const sample = new Function(
    'return (' + syncProgressSamples.toString() + ')'
  )() as typeof syncProgressSamples
  const bar = document.createElement('progress')
  bar.setAttribute('aria-label', '2 of 3')
  bar.setAttribute('value', '2')
  bar.setAttribute('max', '3')
  bar.getBoundingClientRect = () => ({ width: 100 }) as DOMRect
  const doc = { querySelectorAll: () => [bar] } as unknown as Document
  expect(sample([doc, doc])).toEqual([{ label: '2 of 3', value: 2, total: 3, text: '' }])
  // Indeterminate progress has no value; descriptive labels are valid for determinate bars.
  bar.removeAttribute('value')
  bar.setAttribute('aria-label', 'Syncing')
  expect(sample([doc])).toEqual([])
})

it('samples determinate transfer progress whose accessible label describes the transfer', () => {
  const bar = document.createElement('progress')
  bar.setAttribute('aria-label', 'Downloading 2 of 3 files · 4 KB')
  bar.setAttribute('value', '2')
  bar.setAttribute('max', '3')
  bar.getBoundingClientRect = () => ({ width: 100 }) as DOMRect
  const doc = { querySelectorAll: () => [bar] } as unknown as Document
  expect(syncProgressSamples([doc])).toMatchObject([{ value: 2, total: 3 }])
  bar.removeAttribute('value')
  expect(syncProgressSamples([doc])).toEqual([])
})
