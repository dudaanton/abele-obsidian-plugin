import { expect, it, vi } from 'vitest'
import { booksDisposalFor } from '@/scripting/booksLifetime'

it('registers just one plugin cleanup and only keeps still-active subscriptions', () => {
  const registered: (() => void)[] = []
  const plugin = {
    register: (stop: () => void) => {
      registered.push(stop)
    },
  }
  const first = booksDisposalFor(plugin)
  const second = booksDisposalFor(plugin)
  expect(second).toBe(first)
  expect(registered).toHaveLength(1)
  const stopped = vi.fn()
  const active = vi.fn()
  const remove = first(stopped)
  remove()
  first(active)
  registered[0]()
  expect(stopped).not.toHaveBeenCalled()
  expect(active).toHaveBeenCalledOnce()
})
