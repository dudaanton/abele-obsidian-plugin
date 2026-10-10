import { afterEach, describe, expect, it, vi } from 'vitest'
import { echartsInit, getThemeColors } from '@/bases/echarts'
const engine = vi.hoisted(() => ({ init: vi.fn(), registerTheme: vi.fn(), use: vi.fn() }))
vi.mock('echarts/core', () => engine)
afterEach(() => vi.restoreAllMocks())

function theme(prefix: string) {
  return { getPropertyValue: (key: string) => `${prefix}:${key}` } as CSSStyleDeclaration
}
describe('chart theme', () => {
  it('resolves the palette and tooltip from the chart window, not the ambient body', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(theme('ambient'))
    const doc = document.implementation.createHTMLDocument('Sample chart window')
    const getComputedStyle = vi.fn(() => theme('chart'))
    Object.defineProperty(doc, 'defaultView', { value: { getComputedStyle }, configurable: true })
    const el = doc.createElement('div')
    echartsInit(el)
    const options = engine.registerTheme.mock.calls.at(-1)?.[1]
    expect(options.color).toEqual(
      [
        '--interactive-accent',
        '--text-success',
        '--text-error',
        '--color-orange',
        '--color-purple',
        '--color-cyan',
        '--color-pink',
        '--color-blue',
      ].map((key) => `chart:${key}`)
    )
    expect(options.tooltip.extraCssText).toContain('chart:--radius-s')
    expect(options.tooltip.extraCssText).toContain('chart:--shadow-s')
    expect(getComputedStyle).toHaveBeenCalledWith(doc.body)
    expect(getThemeColors(el).bgPrimary).toBe('chart:--background-primary')
    expect(getThemeColors(el).expense).toBe('chart:--text-error')
  })
  it('uses a named host fallback when a theme omits semantic success and error colours', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (key: string) => (key.startsWith('--text-') ? '' : `sample:${key}`),
    } as CSSStyleDeclaration)
    expect(getThemeColors().income).toBe('sample:--color-green')
    expect(getThemeColors().expense).toBe('sample:--color-red')
  })
})
