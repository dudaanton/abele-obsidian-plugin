import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import dayjs from 'dayjs'
import PeriodSelector from '@/components/obsidian/PeriodSelector.vue'

describe('period selector', () => {
  it('holds every month of the year unseen beside the title, so paging never moves the arrows', async () => {
    const w = mount(PeriodSelector, { props: { start: dayjs(), end: dayjs() } })
    const sizers = w.findAll('.abele-period-selector__sizer')
    expect(sizers).toHaveLength(12)
    for (const s of sizers) {
      expect(s.attributes('aria-hidden')).toBe('true')
      expect(s.classes()).toContain('clickable-icon')
    }
    const year = dayjs().year()
    expect(sizers.map((s) => s.text())).toContain(`November ${year}`)
    await w.get('[aria-label="Next month"]').trigger('click')
    expect(w.findAll('.abele-period-selector__sizer')).toHaveLength(12)
    w.unmount()
  })
})
