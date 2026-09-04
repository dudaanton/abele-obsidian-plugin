/**
 * The object a script holds while its tab is open.
 *
 * The host — the service that owns leaves — is a two-method interface here, so what is
 * asserted is the contract between the script and the plugin: open once, hooks fire, timers
 * die with the view, a handler that throws is reported rather than fatal.
 */
import { describe, it, expect, vi } from 'vitest'
import { View, type ViewHost } from '@/scripting/view/View'
import { Button, Stack, Text } from '@/scripting/view/components'

const host = (): ViewHost & { opened: unknown[] } => {
  const h = {
    opened: [] as unknown[],
    async open(view: View, opts: unknown) {
      h.opened.push(opts)
      view.leafId = 'leaf-1'
    },
    close(view: View) {
      void view.dispose()
    },
  }
  return h
}

const origin = { script: 'Demo', params: {} }

describe('View', () => {
  it('opens once, in a tab unless told otherwise', async () => {
    const h = host()
    const v = new View({ title: 'T' }, h, origin)
    await v.open()
    expect(h.opened).toEqual([{ where: 'tab', active: true }])
    expect(v.isOpen).toBe(true)
    await expect(v.open()).rejects.toThrow(/already open/)
    const w = new View({ title: 'W' }, host(), origin)
    await w.open({ where: 'split', active: false })
  })

  it('normalises body to a list and finds nodes by id', () => {
    const v = new View({ title: 'T' }, host(), origin)
    const b = new Button({ text: 'x', id: 'go' })
    v.body = new Stack([b])
    expect(v.nodes.length).toBe(1)
    expect(v.find('go') === b).toBe(true)
    v.body = [new Text('a'), b]
    expect(v.nodes.length).toBe(2)
  })

  it('starts with the restored state and no icon defaults to scroll-text', () => {
    const v = new View({ title: 'T' }, host(), origin, { leafId: 'L', state: { index: 3 } })
    expect(v.state.index).toBe(3)
    expect(v.restore?.leafId).toBe('L')
    expect(v.icon).toBe('scroll-text')
  })

  it('fires close once, clears timers and aborts its signal', async () => {
    vi.useFakeTimers()
    const v = new View({ title: 'T' }, host(), origin)
    const closed = vi.fn()
    const tick = vi.fn()
    v.on('close', closed)
    v.every(10, tick)
    vi.advanceTimersByTime(25)
    expect(tick).toHaveBeenCalledTimes(2)
    await v.dispose()
    await v.dispose()
    vi.advanceTimersByTime(50)
    expect(tick).toHaveBeenCalledTimes(2)
    expect(closed).toHaveBeenCalledTimes(1)
    expect(v.signal.aborted).toBe(true)
    expect(v.isOpen).toBe(false)
    vi.useRealTimers()
  })

  it('run() reports a throwing handler instead of propagating', async () => {
    const v = new View({ title: 'T' }, host(), origin)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await v.run(async () => {
      throw new Error('bad press')
    })
    expect(result).toBeUndefined()
    expect(v.errors).toEqual(['bad press'])
    expect(error).toHaveBeenCalled()
    v.dismissErrors()
    expect(v.errors).toEqual([])
    error.mockRestore()
  })

  it('emit reports a throwing hook the same way', async () => {
    const v = new View({ title: 'T' }, host(), origin)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    v.on('key', () => {
      throw new Error('nope')
    })
    await v.emit('key', {})
    expect(v.errors).toEqual(['nope'])
  })

  it('collects css', () => {
    const v = new View({ title: 'T' }, host(), origin)
    v.style('.a{}').style('.b{}')
    expect(v.css).toEqual(['.a{}', '.b{}'])
  })
})
