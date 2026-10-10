import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import dayjs from 'dayjs'
import Input from '@/components/obsidian/Input.vue'
import DateTimePicker from '@/components/DateTimePicker.vue'
import DateRangePicker from '@/components/DateRangePickerModal.vue'
import RecurrencePicker from '@/components/RecurrencePicker.vue'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))
describe('platform fields in the shared kit', () => {
  it.each(['number', 'date', 'time'] as const)(
    'preserves %s values and constraints through the native control',
    async (type) => {
      const view = mount(Input, {
        props: { type, modelValue: '' },
        attrs: { min: '1', max: '99', 'aria-label': 'Sample value' },
      })
      expect(view.get('input').attributes('type')).toBe(type)
      expect(view.get('input').attributes('min')).toBe('1')
      expect(view.get('input').attributes('aria-label')).toBe('Sample value')
      view.unmount()
    }
  )
  it('shares the native ref and focus helper without losing decorated-field parts or attributes', () => {
    const view = mount(Input, {
      props: { type: 'time', modelValue: '09:15', icon: 'clock', invalid: true, loading: true },
      attrs: {
        class: 'sample-picker-host',
        min: '08:00',
        max: '18:00',
        'aria-label': 'Sample time',
      },
      slots: { trailing: '<span class="sample-trailing">Ready</span>' },
      attachTo: document.body,
    })
    try {
      const native = view.get('input')
      const api = view.vm as unknown as { inputRef: HTMLInputElement; focus: () => void }
      expect(api.inputRef).toBe(native.element)
      api.focus()
      expect(document.activeElement).toBe(native.element)
      expect(view.classes()).toContain('sample-picker-host')
      expect(native.classes()).not.toContain('sample-picker-host')
      expect(native.attributes('aria-label')).toBe('Sample time')
      expect(native.attributes('aria-invalid')).toBe('true')
      expect(native.attributes('min')).toBe('08:00')
      expect(native.attributes('max')).toBe('18:00')
      expect(view.find('.abele-obsidian-input__leading-icon').exists()).toBe(true)
      expect(view.find('.abele-obsidian-input__loading-icon').exists()).toBe(true)
      expect(view.find('.sample-trailing').exists()).toBe(false)
    } finally {
      view.unmount()
    }
  })
  it('opens the platform time picker from a synchronous button gesture', () => {
    const view = mount(Input, { props: { type: 'time', modelValue: '' } })
    const showPicker = vi.fn()
    ;(view.get('input').element as HTMLInputElement).showPicker = showPicker
    ;(view.vm as unknown as { showPicker: () => void }).showPicker()
    expect(showPicker).toHaveBeenCalledOnce()
    view.unmount()
  })
})
describe('picker field behaviour', () => {
  it('keeps typed and platform-picked time, clear and confirm in agreement', async () => {
    const view = mount(DateTimePicker, {
      props: { initialDate: dayjs('2024-05-06') },
      global: { stubs: { Calendar: true } },
    })
    await view.get('input[type="text"]').setValue('9:05')
    ;(view.vm as unknown as { confirm: () => void }).confirm()
    expect(view.emitted('confirm')?.[0]?.[0]).toMatchObject({ time: '09:05' })
    await view.get('input[type="time"]').setValue('14:30')
    expect((view.get('input[type="text"]').element as HTMLInputElement).value).toBe('14:30')
    view.unmount()
  })
  it('preserves numbered recurrence and month-day parsing', async () => {
    const view = mount(RecurrencePicker, {
      props: { initialPattern: 'every 2 month on 1, 15 from completion' },
    })
    await view.get('input[type="number"]').setValue('3')
    await view.get('input[placeholder="e.g. 1, 15"]').setValue('2, 20')
    ;(view.vm as unknown as { confirm: () => void }).confirm()
    expect(view.emitted('confirm')).toEqual([['every 3 month on 2, 20 from completion']])
    view.unmount()
  })
  it('normalizes a reversed typed range without changing day boundaries', async () => {
    const view = mount(DateRangePicker, {
      global: { stubs: { ObsidianModal: { template: '<div><slot/><slot name="footer"/></div>' } } },
    })
    const fields = view.findAll('input')
    await fields[0].setValue('2024-05-20')
    await fields[0].trigger('change')
    await fields[1].setValue('2024-05-02')
    await fields[1].trigger('change')
    await view.get('button.mod-cta').trigger('click')
    const range = view.emitted('apply')?.[0]?.[0] as { from: dayjs.Dayjs; to: dayjs.Dayjs }
    expect(range.from.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-05-02 00:00:00')
    expect(range.to.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-05-20 23:59:59')
    view.unmount()
  })
})
