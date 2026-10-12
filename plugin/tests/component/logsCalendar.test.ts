/**
 * A note's logs read as a month: the switch in the section's heading, the choice kept for the
 * note, the marks under the days and the chosen day's entries.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import dayjs from 'dayjs'
import LogsCalendar from '@/components/LogsCalendar.vue'
import LogsList from '@/components/LogsList.vue'
import { Log } from '@/entities/Log'
import { provideFooterFold } from '@/composables/useFooterFold'
import { FOOTER_VIEW_KEY, resetFooterView } from '@/composables/useFooterView'
import { configureAbele, useVault } from '../helpers/testEnv'

const NOTE = 'Habits/Water the tomatoes.md'

function log(daysAgo: number, content: string): Log {
  const date = dayjs().subtract(daysAgo, 'day')
  const l = new Log(`Journal/${date.format('YYYY-MM-DD')}.md`, NOTE)
  l.createdAt = date
  l.content = content
  l.loaded = true
  l.load = async () => {}
  l.loadContent = async () => {}
  return l
}

function footer(logs: Log[]) {
  const Host = defineComponent({
    setup() {
      provideFooterFold(() => NOTE)
      return () => h(LogsList, { logs })
    },
  })
  return mount(Host, { attachTo: document.body })
}

describe('the logs under a note as a calendar', () => {
  let app: ReturnType<typeof useVault>
  beforeEach(() => {
    configureAbele()
    app = useVault([])
    app.saveLocalStorage(FOOTER_VIEW_KEY, {})
    resetFooterView()
  })

  it('switches from the list to the month from the heading, and keeps it for the note', async () => {
    const wrapper = footer([log(0, '- [x] [[Water the tomatoes]]')])
    expect(wrapper.find('.abele-calendar').exists()).toBe(false)

    await wrapper.find('.abele-logs-list__view').trigger('click')
    expect(wrapper.find('.abele-calendar').exists()).toBe(true)
    wrapper.unmount()

    resetFooterView()
    const again = footer([log(0, '- [x] [[Water the tomatoes]]')])
    expect(again.find('.abele-calendar').exists()).toBe(true)
    again.unmount()
  })

  it('turns one month at a time even when today is the last day of a long month', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2030, 0, 31, 12))
    const wrapper = mount(LogsCalendar, { props: { logs: [] } })
    try {
      await wrapper.findAll('.abele-calendar__header-controls .clickable-icon')[1].trigger('click')
      expect(wrapper.find('.abele-calendar__header-month-year').text()).toBe('February 2030')
      expect(wrapper.find('.abele-logs-calendar__day-title').text()).toContain('1 February 2030')
      expect(wrapper.find('.abele-logs-calendar__none').text()).toBe('Nothing written in February.')
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
    }
  })

  it('marks a ticked day, a day left open and a day of words apart', async () => {
    app.saveLocalStorage(FOOTER_VIEW_KEY, { [NOTE]: { logsCalendar: true } })
    resetFooterView()
    const wrapper = footer([
      log(0, '- [x] [[Water the tomatoes]]'),
      log(1, '- [ ] [[Water the tomatoes]]'),
      log(2, 'Watered twice, it was hot.'),
    ])
    await new Promise((r) => setTimeout(r))
    const marks = wrapper.findAll('.abele-calendar__day-log').map((m) => m.classes())
    expect(marks.some((c) => c.includes('abele-calendar__day-log_done'))).toBe(true)
    expect(marks.some((c) => c.includes('abele-calendar__day-log_open'))).toBe(true)
    expect(
      marks.some(
        (c) =>
          !c.includes('abele-calendar__day-log_done') && !c.includes('abele-calendar__day-log_open')
      )
    ).toBe(true)
    wrapper.unmount()
  })
})
