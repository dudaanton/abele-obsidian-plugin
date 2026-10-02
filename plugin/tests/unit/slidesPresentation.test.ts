import { describe, expect, it, vi } from 'vitest'
import { Presentation } from '@/slides/core/Presentation'

describe('shared presentation state', () => {
  it('reveals steps before paging and reverses through the previous slide’s steps', () => {
    const show = new Presentation(3)
    show.setSteps(0, 2)
    show.go('next')
    expect([show.index, show.step]).toEqual([0, 1])
    show.go('next')
    show.go('next')
    expect([show.index, show.step]).toEqual([1, 0])
    show.go('previous')
    expect([show.index, show.step]).toEqual([0, 2])
    show.go('previous')
    expect(show.step).toBe(1)
    show.go('last')
    expect([show.index, show.step]).toEqual([2, 0])
  })

  it('shares synchronous updates, preserves bounded state on edits and ends only once', () => {
    const show = new Presentation(4, 2)
    const changed = vi.fn()
    const ended = vi.fn()
    const unwatch = show.watch(changed)
    show.onEnd(ended)
    show.setSteps(2, 4)
    show.go('next')
    expect(changed).toHaveBeenCalled()
    show.resize(2)
    expect([show.index, show.step]).toEqual([1, 0])
    unwatch()
    changed.mockClear()
    show.end()
    show.end()
    show.go('first')
    expect(changed).not.toHaveBeenCalled()
    expect(ended).toHaveBeenCalledTimes(1)
    expect(show.index).toBe(1)
  })

  it('measures elapsed monotonic time with pause, resume and reset', () => {
    let now = 1000
    const show = new Presentation(1, 0, () => now)
    now += 5000
    expect(show.elapsed).toBe(5000)
    show.toggleTimer()
    now += 4000
    expect(show.elapsed).toBe(5000)
    show.toggleTimer()
    now += 1000
    expect(show.elapsed).toBe(6000)
    show.resetTimer()
    expect(show.elapsed).toBe(0)
    show.end()
    now += 2000
    expect(show.elapsed).toBe(0)
  })
})
