import { expect, it, vi } from 'vitest'
import { onReaderEvent } from '@/reader/readerEvents'

it('does not let a replaced book renderer update or save the current book position', () => {
  const old = new EventTarget()
  const next = new EventTarget()
  let current = old
  const saved = vi.fn()
  onReaderEvent(old, 'relocate', () => current === old, saved)
  old.dispatchEvent(new Event('relocate'))
  expect(saved).toHaveBeenCalledOnce()
  current = next
  old.dispatchEvent(new Event('relocate'))
  expect(saved).toHaveBeenCalledOnce()
})
