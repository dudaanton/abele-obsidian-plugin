/**
 * The row of bars a voice message is read by.
 *
 * What matters is that it says the same thing at any length — a five-second clip and a
 * five-minute one both have to fit the pane — and that playback is visible on it.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Waveform from '@/components/obsidian/Waveform.vue'

const drawn = (levels: number[], progress?: number) =>
  mount(Waveform, { props: { levels, ...(progress === undefined ? {} : { progress }) } })

const bars = (wrapper: ReturnType<typeof drawn>) => wrapper.findAll('.abele-waveform__bar')

describe('a waveform', () => {
  it('draws a bar per reading while there are few of them', () => {
    expect(bars(drawn([0.2, 0.4, 0.6]))).toHaveLength(3)
  })

  it('stays the same width however long the recording gets', () => {
    const short = bars(drawn(Array.from({ length: 200 }, () => 0.5))).length
    const long = bars(drawn(Array.from({ length: 4000 }, () => 0.5))).length

    expect(short).toBe(long)
    expect(short).toBeLessThan(100)
  })

  it('keeps the shape of what was said rather than flattening it', () => {
    const quietThenLoud = [...Array(500).fill(0.1), ...Array(500).fill(0.9)]

    const heights = bars(drawn(quietThenLoud)).map((b) => b.attributes('style') ?? '')

    expect(heights[0]).toContain('10%')
    expect(heights.at(-1)).toContain('90%')
  })

  it('gives a silent moment a mark of its own, so the row does not break up', () => {
    expect(bars(drawn([0]))[0].attributes('style')).toContain('8%')
  })

  it('shows how far playback has got', () => {
    const played = bars(drawn(Array.from({ length: 10 }, () => 0.5), 0.5)).filter((b) =>
      b.classes().includes('abele-waveform__bar_played')
    )

    expect(played).toHaveLength(5)
  })

  it('marks nothing as played when nothing is playing', () => {
    const played = bars(drawn([0.5, 0.5])).filter((b) =>
      b.classes().includes('abele-waveform__bar_played')
    )

    expect(played).toHaveLength(0)
  })

  it('draws nothing at all before anything has been heard', () => {
    expect(bars(drawn([]))).toHaveLength(0)
  })
})
