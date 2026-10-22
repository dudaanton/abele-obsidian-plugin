import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import StateLine from '@/components/obsidian/StateLine.vue'
import FoldHeading from '@/components/obsidian/FoldHeading.vue'

it('keeps the log inside Details even before operation facts are available', async () => {
  const view = mount(StateLine, { props: { text: 'Waiting…', tone: 'faint', log: true } })
  expect(view.find('a').exists()).toBe(false)
  await view.getComponent(FoldHeading).trigger('keydown', { key: 'Enter' })
  expect(view.get('a').text()).toBe('Node log')
  view.unmount()
})

it('keeps evidence and log links folded, with the action below the sentence', async () => {
  const view = mount(StateLine, {
    props: {
      text: 'Sample failure',
      tone: 'orange',
      action: 'Retry',
      log: true,
      details: [
        { label: 'Code', value: 'sample_failure', code: true },
        { label: 'Where', value: 'Sample folder' },
      ],
    },
  })
  expect(view.text()).not.toContain('sample_failure')
  expect(view.find('a').exists()).toBe(false)
  expect(view.getComponent(FoldHeading).props('hang')).toBe(true)
  await view.get('button').trigger('click')
  expect(view.emitted('action')).toHaveLength(1)
  await view.getComponent(FoldHeading).trigger('keydown', { key: 'Enter' })
  expect(view.get('.is-code').text()).toBe('sample_failure')
  expect(view.findAll('.is-code')).toHaveLength(1)
  await view.get('a').trigger('click')
  expect(view.emitted('log')).toHaveLength(1)
  await view.findAll('a')[1]!.trigger('click')
  expect(view.emitted('copy')).toHaveLength(1)
  await view.setProps({ details: [{ label: 'Code', value: 'new_failure', code: true }] })
  expect(view.text()).toContain('new_failure')
  view.unmount()
})
