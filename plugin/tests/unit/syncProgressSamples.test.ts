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
  bar.setAttribute('aria-label', 'Syncing')
  expect(sample([doc])).toEqual([])
})
