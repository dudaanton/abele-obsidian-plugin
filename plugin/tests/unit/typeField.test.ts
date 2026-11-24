import { afterEach, describe, expect, it, vi } from 'vitest'
import { typeField } from '../e2e/helpers/typeField'

afterEach(() => vi.useRealTimers())

describe('typeField', () => {
  it('reselects and retypes when native input drops the first characters', async () => {
    let value = ''
    let selected = false
    let calls = 0
    const type = vi.fn((text: string) => {
      value = ++calls === 1 ? text.slice(2) : selected ? text : value + text
      selected = false
    })
    const select = vi.fn(() => {
      selected = true
    })
    await typeField('Sample diagram', { type, read: () => value, select })
    expect(value).toBe('Sample diagram')
    expect(select).toHaveBeenCalledOnce()
    expect(type).toHaveBeenCalledTimes(2)
  })

  it('waits for a delayed native edit before retrying', async () => {
    vi.useFakeTimers()
    let value = ''
    const type = vi.fn((text: string) => {
      setTimeout(() => {
        value = text
      }, 400)
    })
    const select = vi.fn()
    const pending = typeField('Sample diagram', { type, read: () => value, select })
    await vi.advanceTimersByTimeAsync(500)
    await pending
    expect(type).toHaveBeenCalledOnce()
    expect(select).not.toHaveBeenCalled()
  })

  it('types a correct value only once', async () => {
    let value = ''
    const type = vi.fn((text: string) => {
      value = text
    })
    const select = vi.fn()
    await typeField('Sample diagram', { type, read: () => value, select })
    expect(type).toHaveBeenCalledOnce()
    expect(select).not.toHaveBeenCalled()
  })

  it('fails after one retry if native typing still loses input', async () => {
    const type = vi.fn()
    await expect(
      typeField('Sample diagram', {
        type,
        read: () => 'mple diagram',
        select: vi.fn(),
      })
    ).rejects.toThrow('Native typing did not fill the field')
    expect(type).toHaveBeenCalledTimes(2)
  })
})
