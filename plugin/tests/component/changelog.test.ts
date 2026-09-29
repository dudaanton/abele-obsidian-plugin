import { mount } from '@vue/test-utils'
import { reactive, nextTick } from 'vue'
import { expect, it } from 'vitest'
import Changelog from '@/components/changelog/Changelog.vue'
import type { Release, Range } from '@/changelog/model'

it('pages every version newest first, filters before paging, escapes text and resets paging and scroll', async () => {
  const releases: Release[] = Array.from({ length: 23 }, (_, n) => ({
    version: `1.${23 - n}.0`,
    date: '2025-01-01',
    features:
      n === 0 ? ['<img src=x onerror=alert(1)> https://example.invalid'] : [`Sample item ${n}`],
    fixes: [],
    improvements: [],
  }))
  const model = reactive<{ range: Range | null }>({ range: null })
  const wrapper = mount(Changelog, { props: { releases, model } })
  expect(wrapper.findAll('article')).toHaveLength(10)
  expect(wrapper.find('article').text()).toContain('1.23.0')
  expect(wrapper.find('article').text()).toContain('2025-01-01')
  expect(wrapper.find('article').text()).toContain('New features')
  expect(wrapper.find('img, a, iframe, script').exists()).toBe(false)
  await wrapper.find('button').trigger('click')
  expect(wrapper.findAll('article')).toHaveLength(20)
  await wrapper.find('button').trigger('click')
  expect(wrapper.findAll('article')).toHaveLength(23)
  expect(wrapper.findAll('article').at(-1)?.text()).toContain('1.1.0')
  const scroller = wrapper.find('.abele-changelog__scroll').element as HTMLElement
  scroller.scrollTop = 200
  model.range = { from: '1.20.0', to: '1.23.0' }
  await nextTick()
  await nextTick()
  expect(scroller.scrollTop).toBe(0)
  expect(wrapper.findAll('article')).toHaveLength(3)
  expect(wrapper.text()).toContain("What's new since 1.20.0 through 1.23.0")
  await wrapper.find('button').trigger('click')
  expect(wrapper.findAll('article')).toHaveLength(10)
  wrapper.unmount()
})

it('honestly displays maintenance-only, empty ranges and recovered dates', () => {
  const releases: Release[] = [
    {
      version: '1.0.0',
      date: '2025-01-01',
      dateSource: 'history',
      features: [],
      fixes: [],
      improvements: [],
    },
  ]
  const wrapper = mount(Changelog, { props: { releases, model: { range: null } } })
  expect(wrapper.text()).toContain('No user-facing changes recorded')
  expect(wrapper.text()).toContain('Recovered version history')
  wrapper.unmount()
  const empty = mount(Changelog, {
    props: { releases, model: { range: { from: '2.0.0', to: '3.0.0' } } },
  })
  expect(empty.text()).toContain('No versions in this range')
  empty.unmount()
})
