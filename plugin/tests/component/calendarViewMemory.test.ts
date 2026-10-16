import { expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import dayjs from 'dayjs'
import { Log } from '@/entities/Log'
import { defineComponent, h } from 'vue'
import LogsCalendar from '@/components/LogsCalendar.vue'
import TasksCalendar from '@/components/TasksCalendar.vue'
import { provideFooterFold } from '@/composables/useFooterFold'
import { FOOTER_VIEW_KEY, resetFooterView } from '@/composables/useFooterView'
import { configureAbele, useVault } from '../helpers/testEnv'

it('loads checkbox marks outside the current month when opening the year', async () => {
  configureAbele()
  useVault([])
  const date = dayjs()
    .startOf('year')
    .add(dayjs().month() === 0 ? 6 : 0, 'month')
    .date(12)
  const log = new Log('Sample entry.md', 'Sample.md')
  log.createdAt = date
  log.loaded = true
  log.load = async () => {}
  log.content = undefined
  log.loadContent = async () => {
    log.content = '- [ ] Sample entry'
  }
  const today = new Log('Sample today.md', 'Sample.md')
  today.createdAt = dayjs()
  today.content = 'Sample entry'
  today.loaded = true
  today.load = async () => {}
  const wrapper = mount(LogsCalendar, { props: { logs: [log, today] } })
  await wrapper.get('.abele-calendar__header-month-year').trigger('click')
  await flushPromises()
  expect(wrapper.get(`[data-day="${date.format('YYYY-MM-DD')}"]`).classes()).toContain(
    'abele-calendar-year__day_heat-open'
  )
  wrapper.unmount()
})

it.each([LogsCalendar, TasksCalendar])(
  'restores the chosen year after unmount and returns to a month from its name',
  async (component) => {
    configureAbele()
    const app = useVault([])
    app.saveLocalStorage(FOOTER_VIEW_KEY, {})
    resetFooterView()
    const Host = defineComponent({
      setup() {
        provideFooterFold(() => 'Sample.md')
        return () => h(component, { logs: [], tasks: [] })
      },
    })
    let wrapper = mount(Host)
    await wrapper.get('.abele-calendar__header-month-year').trigger('click')
    expect(wrapper.find('.abele-calendar-year').exists()).toBe(true)
    wrapper.unmount()
    resetFooterView()
    wrapper = mount(Host)
    expect(wrapper.find('.abele-calendar-year').exists()).toBe(true)
    await wrapper.findAll('.abele-calendar-year__month-name')[0].trigger('click')
    expect(wrapper.find('.abele-calendar__days').exists()).toBe(true)
    wrapper.unmount()
    resetFooterView()
    wrapper = mount(Host)
    expect(wrapper.find('.abele-calendar-year').exists()).toBe(false)
    wrapper.unmount()
  }
)
