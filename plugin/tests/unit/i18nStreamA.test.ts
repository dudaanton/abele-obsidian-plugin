import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { extract } from '../../scripts/i18n-manifest.mjs'
import { t } from '../../src/i18n'
import { initializeLocale } from '../helpers/i18n'
import { formatAmount } from '../../src/helpers/moneyFormat'
import { catalogs, validateCatalogs } from '../../src/i18n/catalogs'
import { mount } from '@vue/test-utils'
import RecurrencePicker from '../../src/components/RecurrencePicker.vue'
import dayjs from 'dayjs'
import { areaDate, relativeDay } from '../../src/helpers/areaDateFormat'
import { relativeTime, stepDate, withDay } from '../../src/properties/dates'
import { tasks as englishTasks } from '../../src/i18n/locales/en/tasks'
import ledger from '../../src/i18n/tasks-ledger.json'
import { createHash } from 'node:crypto'
import { paintLaneNames } from '../../src/components/timelineBase/timelineChrome'
import type { Frame } from '../../src/components/timelineBase/timelineDraw'

afterEach(() => initializeLocale('en'))

it('extracts task and date dialog presentation into the catalogs', () => {
  for (const path of ['components/TaskHeader.vue', 'components/DateTimePickerModal.vue']) {
    expect(extract(path, readFileSync(`src/${path}`, 'utf8'))).toEqual([])
  }
})

it('keeps English money formatting and localizes other languages without negative zero', () => {
  initializeLocale('en')
  expect(formatAmount(1234.5)).toBe(
    (1234.5).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
  for (const language of ['ru', 'lv', 'es', 'de']) {
    initializeLocale(language)
    expect(formatAmount(1234.5)).toBe(
      new Intl.NumberFormat(language, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(1234.5)
    )
    expect(formatAmount(-0.00001)).toBe(formatAmount(0))
  }
})

it('provides complete catalogs and preserves caller-owned placeholders', () => {
  expect(validateCatalogs(catalogs)).toEqual([])
  for (const language of ['en', 'ru', 'lv', 'es', 'de'] as const) {
    expect(Object.keys(catalogs[language])).toEqual(Object.keys(catalogs.en))
  }
  expect(
    Object.fromEntries(
      Object.entries(englishTasks).map(([key, value]) => [
        key,
        createHash('sha256').update(JSON.stringify(value)).digest('hex'),
      ])
    )
  ).toEqual(
    Object.fromEntries(Object.entries(ledger).map(([key, entry]) => [key, entry.englishHash]))
  )
  initializeLocale('en')
  expect(t('area.dateValue', { value: '14.05.2025' })).toBe('Date 14.05.2025')
  expect(t('area.subtasksAdd', { done: 1, total: 3 })).toBe('1 of 3 subtasks done · Add subtask')
  initializeLocale('ru')
  expect(t('area.noteCount', { count: 21 })).toBe('21 заметка')
  expect(
    t('area.eventLabel', { title: 'Sample event', time: '09:00', calendar: 'Sample feed' })
  ).toBe('Sample event, 09:00, календарь: Sample feed')
})

it('localizes calendar names and relative days without changing stored date values', () => {
  const date = dayjs('2025-05-14')
  initializeLocale('en')
  expect(areaDate(date, 'MMMM YYYY')).toBe(date.format('MMMM YYYY'))
  expect(relativeDay(0)).toBe('Today')
  for (const language of ['ru', 'lv', 'es', 'de']) {
    initializeLocale(language)
    expect(areaDate(date, 'MMMM')).toBe(
      new Intl.DateTimeFormat(language, { month: 'long' }).format(date.toDate())
    )
    expect(relativeDay(1)).toBe(
      new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(1, 'day')
    )
    expect(relativeTime('2025-05-15', new Date(2025, 4, 14))).toBe(relativeDay(1))
    expect(stepDate('2025-05-14T09:30', 1)).toBe('2025-05-15T09:30')
    expect(withDay('2025-05-14T09:30', '2025-05-15', '10:00')).toBe('2025-05-15T10:00')
  }
})

it('keeps recurrence parsing and emitted patterns English in every UI language', () => {
  for (const language of ['en', 'ru', 'lv', 'es', 'de']) {
    initializeLocale(language)
    for (const pattern of [
      'every 2 week on Mon, Fri',
      'every first Monday',
      'every last day of year from completion',
    ]) {
      const picker = mount(RecurrencePicker, {
        props: { initialPattern: pattern },
        global: {
          stubs: ['ObsidianIcon', 'ObsidianDropdown', 'Checkbox', 'Input', 'Setting', 'Section'],
        },
      })
      picker.vm.confirm()
      expect(picker.emitted('confirm')?.[0]?.[0]).toBe(pattern)
      picker.unmount()
    }
  }
})

it('paints localized note counts on the timeline canvas', () => {
  const fillText = vi.fn()
  const context = {
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    fillRect() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    fill() {},
    fillText,
    measureText: (text: string) => ({ width: text.length * 5 }),
  } as unknown as CanvasRenderingContext2D
  const frame = {
    palette: {
      background: '#fff',
      border: '#ccc',
      accent: '#777',
      text: '#000',
      faint: '#aaa',
      small: 12,
      smaller: 10,
    },
    scene: {
      metrics: { labelW: 200, laneHead: 20, lineH: 16 },
      boxes: [{ lane: { label: 'Sample lane', count: 21 }, top: 0, height: 100 }],
    },
    scrollY: 0,
    width: 300,
  } as unknown as Frame
  initializeLocale('ru')
  paintLaneNames(context, frame, 0, 200)
  expect(fillText.mock.calls.map((call) => call[0])).toContain('21 заметка')
  initializeLocale('en')
  paintLaneNames(context, frame, 0, 200)
  expect(fillText.mock.calls.map((call) => call[0])).toContain('21 notes')
})

it('inflects recurrence interval units when the count changes', async () => {
  initializeLocale('ru')
  const picker = mount(RecurrencePicker, {
    global: {
      stubs: {
        Setting: { template: '<div><slot /></div>' },
        Section: { template: '<div><slot /></div>' },
        Input: { name: 'Input', props: ['modelValue'], template: '<input />' },
        ObsidianDropdown: {
          name: 'ObsidianDropdown',
          props: ['options', 'modelValue'],
          template: '<select />',
        },
        ObsidianIcon: true,
        Checkbox: true,
      },
    },
  })
  const units = () =>
    picker.findComponent({ name: 'ObsidianDropdown' }).props('options') as {
      value: string
      display: string
    }[]
  expect(units().find((unit) => unit.value === 'day')?.display).toBe('день')
  picker.findComponent({ name: 'Input' }).vm.$emit('update:modelValue', '5')
  await picker.vm.$nextTick()
  expect(units().find((unit) => unit.value === 'day')?.display).toBe('дней')
  picker.unmount()
})

it('matches Russian ordinal labels to the selected weekday without changing the pattern', async () => {
  initializeLocale('ru')
  const picker = mount(RecurrencePicker, {
    props: { initialPattern: 'every first Wednesday' },
    global: {
      stubs: {
        Setting: { template: '<div><slot /></div>' },
        Section: { template: '<div><slot /></div>' },
        Input: true,
        Checkbox: true,
        ObsidianIcon: true,
        ObsidianDropdown: {
          name: 'ObsidianDropdown',
          props: ['options', 'modelValue'],
          template: '<select />',
        },
      },
    },
  })
  const dropdowns = picker.findAllComponents({ name: 'ObsidianDropdown' })
  const first = () => (dropdowns[1].props('options') as { display: string }[])[0].display
  expect(first()).toBe('Первая')
  picker.vm.confirm()
  expect(picker.emitted('confirm')?.[0]?.[0]).toBe('every first Wednesday')
  dropdowns[2].vm.$emit('update:modelValue', '0')
  await picker.vm.$nextTick()
  expect(first()).toBe('Первое')
  picker.vm.confirm()
  expect(picker.emitted('confirm')?.[1]?.[0]).toBe('every first Sunday')
  picker.unmount()
})
