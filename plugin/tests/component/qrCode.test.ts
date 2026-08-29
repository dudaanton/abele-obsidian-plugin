/**
 * The kit's QR code.
 *
 * What can be asserted without a camera: that the picture is drawn from the text and changes
 * with it, that the quiet zone a scanner looks for is there, and that the code stays dark on
 * light in a theme where everything else inverts.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import QrCode from '@/components/obsidian/QrCode.vue'

const drawn = (text: string, level?: 'L' | 'M' | 'Q' | 'H') =>
  mount(QrCode, { props: { text, ...(level ? { level } : {}) } })

describe('a QR code', () => {
  it('draws the text it was given', () => {
    const wrapper = drawn('ABL1:ABCD:1/1:AAAA')

    expect(wrapper.find('path').attributes('d')?.length).toBeGreaterThan(100)
  })

  it('draws something different for different text', () => {
    const first = drawn('ABL1:ABCD:1/2:AAAA').find('path').attributes('d')
    const second = drawn('ABL1:ABCD:2/2:BBBB').find('path').attributes('d')

    expect(first).not.toBe(second)
  })

  it('grows to fit what it is asked to carry', () => {
    const small = drawn('ABL1:ABCD:1/1:AAAA')
    const large = drawn(`ABL1:ABCD:1/1:${'A'.repeat(600)}`)

    const side = (wrapper: ReturnType<typeof drawn>) =>
      Number(wrapper.find('svg').attributes('viewBox')?.split(' ')[2])

    expect(side(large)).toBeGreaterThan(side(small))
  })

  /** Without the margin a scanner cannot find the code's edges against whatever is behind it. */
  it('keeps the quiet zone a scanner looks for', () => {
    const wrapper = drawn('ABL1:ABCD:1/1:AAAA')
    const side = Number(wrapper.find('svg').attributes('viewBox')?.split(' ')[2])
    const modules = [...(wrapper.find('path').attributes('d') ?? '').matchAll(/M(\d+) (\d+)/g)]

    const coordinates = modules.flatMap(([, x, y]) => [Number(x), Number(y)])
    expect(Math.min(...coordinates)).toBeGreaterThanOrEqual(4)
    expect(Math.max(...coordinates)).toBeLessThanOrEqual(side - 4 - 1)
  })

  it('carries a plate behind the modules, so it never reads as inverted', () => {
    const wrapper = drawn('ABL1:ABCD:1/1:AAAA')

    expect(wrapper.find('rect.abele-qr__plate').exists()).toBe(true)
  })

  it('takes a stronger correction level when asked', () => {
    const forgiving = drawn('ABL1:ABCD:1/1:AAAA', 'H').find('path').attributes('d')
    const usual = drawn('ABL1:ABCD:1/1:AAAA', 'M').find('path').attributes('d')

    expect(forgiving).not.toBe(usual)
  })
})
