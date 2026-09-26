/**
 * Events of external calendars among the tasks: shown apart from them — no checkbox, the
 * calendar's colour and name — in the order of the day, and offering a meeting note. And the
 * settings screen that connects a calendar, whose link never reaches the settings file.
 */
process.env.TZ = 'Europe/Berlin'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import dayjs from 'dayjs'
import { Menu, type MenuItem } from 'obsidian'
import Timeline from '@/components/Timeline.vue'
import CalendarEventView from '@/components/CalendarEvent.vue'
import CalendarsSettings from '@/components/settings/CalendarsSettings.vue'
import SecretField from '@/components/settings/SecretField.vue'
import Button from '@/components/obsidian/Button.vue'
import Icon from '@/components/obsidian/Icon.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import { Task } from '@/entities/Task'
import { AbeleConfig } from '@/services/AbeleConfig'
import { secrets } from '@/secrets/SecretStore'
import type { CalendarEvent } from '@/calendars/events'
import type { ShownEvent } from '@/calendars/CalendarService'
import { calendarKeyId, newFeed, type CalendarFeed } from '@/calendars/settings'
import { createMeetingNote, meetingNoteContent } from '@/calendars/meetingNote'
import { installFakeIntersectionObserver } from '../helpers/fakeIntersectionObserver'
import { useVault, configureAbele } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const at = (text: string) => new Date(text).getTime()

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'f:e1:once',
  feedId: 'f',
  uid: 'e1',
  title: 'Dentist',
  allDay: false,
  start: at('2026-04-10T09:00:00+02:00'),
  end: at('2026-04-10T09:30:00+02:00'),
  location: 'Main street 4',
  description: '',
  url: '',
  attendees: [],
  ...over,
})

const feed: CalendarFeed = { ...newFeed([]), id: 'f', name: 'Family', color: 'green' }

let app: FakeApp
let wrapper: VueWrapper | null = null

beforeEach(() => {
  installFakeIntersectionObserver()
  app = useVault([{ path: 'People/Anna Berg.md', content: '# Anna' }])
  configureAbele()
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.restoreAllMocks()
})

describe('the timeline with calendar events', () => {
  const task = (title: string, time?: string) => {
    const t = new Task({ wikilink: `[[Tasks/${title}]]` })
    t.loaded = true
    t.title = title
    t.date = dayjs('2026-04-10')
    if (time) t.dateTime = time
    return t
  }

  const render = (tasks: Task[], events: Map<string, ShownEvent[]>) => {
    wrapper = mount(Timeline, {
      props: { tasks, events },
      global: {
        stubs: {
          TaskView: { props: ['task'], template: '<div class="task-stub">{{ task.title }}</div>' },
        },
      },
    })
    return wrapper
  }

  it('puts the events among the day’s tasks, in the order of the day', () => {
    const view = render(
      [task('Call the bank', '08:00'), task('Buy a present')],
      new Map([
        [
          '2026-04-10',
          [
            { event: event(), feed },
            {
              event: event({
                id: 'f:trip',
                title: 'Trip',
                allDay: true,
                startDay: '2026-04-10',
                start: Date.UTC(2026, 3, 10),
                end: Date.UTC(2026, 3, 11),
              }),
              feed,
            },
          ],
        ],
      ])
    )
    const rows = view
      .findAll('.abele-timeline__tasks > *')
      .map((r) =>
        r.classes('abele-calendar-event')
          ? `event: ${r.find('.abele-calendar-event__title').text()}`
          : `task: ${r.text()}`
      )
    expect(rows).toEqual([
      'event: Trip',
      'task: Call the bank',
      'event: Dentist',
      'task: Buy a present',
    ])
  })

  it('makes a day of its own for an event on a day with no tasks', () => {
    const view = render(
      [],
      new Map([
        [
          '2026-04-12',
          [
            {
              event: event({
                start: at('2026-04-12T10:00:00+02:00'),
                end: at('2026-04-12T11:00:00+02:00'),
              }),
              feed,
            },
          ],
        ],
      ])
    )
    expect(view.findAll('.abele-timeline__date-block')).toHaveLength(1)
    expect(view.findAllComponents(CalendarEventView)).toHaveLength(1)
  })
})

describe('an event in a list', () => {
  const render = (e: CalendarEvent, day = '2026-04-10') => {
    wrapper = mount(CalendarEventView, { props: { event: e, feed, day } })
    return wrapper
  }

  it('cannot be ticked, and says when, where and from which calendar', () => {
    const view = render(event())
    expect(view.find('input[type="checkbox"]').exists()).toBe(false)
    expect(view.classes()).toContain('abele-calendar-event_color-green')
    expect(view.text()).toContain('09:00–09:30')
    expect(view.text()).toContain('Main street 4')
    expect(view.text()).toContain('Family')
  })

  it('says where a night-long event stands on each of its days', () => {
    const night = event({
      start: at('2026-04-10T22:00:00+02:00'),
      end: at('2026-04-11T06:00:00+02:00'),
    })
    expect(render(night).text()).toContain('From 22:00')
    wrapper!.unmount()
    expect(render(night, '2026-04-11').text()).toContain('Until 06:00')
  })

  it('counts the days of a trip', () => {
    const trip = event({ allDay: true, startDay: '2026-04-10', endDay: '2026-04-13' })
    expect(render(trip, '2026-04-11').text()).toContain('All day, 2 of 3')
  })

  it('offers a meeting note, and its link when it has one', async () => {
    const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const view = render(event({ url: 'https://meet.example.com/x' }))
    await view.trigger('click')
    const menu = shown.mock.contexts[0] as unknown as Menu
    expect(menu.items.map((i: MenuItem) => i.title)).toEqual([
      'Create meeting note',
      'Open the event link',
    ])
  })
})

describe('a meeting note', () => {
  it('belongs to the day, and links the people the vault knows', () => {
    const text = meetingNoteContent(
      event({ attendees: ['Anna Berg', 'Someone New'] }),
      '2026-04-10',
      (name) => (name === 'Anna Berg' ? '[[Anna Berg]]' : null)
    )
    expect(text).toBe(
      [
        '---',
        'groups:',
        '  - "[[2026-04-10]]"',
        '---',
        'Dentist',
        '',
        '09:00–09:30 · Main street 4',
        'With [[Anna Berg]], Someone New',
        '',
      ].join('\n')
    )
  })

  it('is made once and opened after that', async () => {
    const opened: string[] = []
    const fake = app as unknown as Record<string, any>
    fake.fileManager.getNewFileParent = () => ({ path: 'Meetings' })
    fake.workspace = {
      getLeaf: () => ({ openFile: async (f: { path: string }) => void opened.push(f.path) }),
    }
    const e = event({ attendees: ['Anna Berg'] })
    await createMeetingNote(e, '2026-04-10')
    await createMeetingNote(e, '2026-04-10')
    expect(opened).toEqual(['Meetings/Dentist 2026-04-10.md', 'Meetings/Dentist 2026-04-10.md'])
    const content = await app.vault.read(
      app.vault.getAbstractFileByPath('Meetings/Dentist 2026-04-10.md') as never
    )
    expect(content).toContain('With [[Anna Berg]]')
  })
})

describe('the settings screen', () => {
  const config = AbeleConfig.getInstance()

  beforeEach(() => {
    config.applySettings(undefined)
    config.calendars = { refreshMinutes: 30, feeds: [] }
  })

  const button = (view: VueWrapper, text: string) =>
    view.findAllComponents(Button).find((b) => b.props('text') === text)!

  it('keeps a pasted link in the keychain, as https, and only its name in the settings', async () => {
    wrapper = mount(CalendarsSettings)
    await button(wrapper, 'Add calendar').trigger('click')
    await flushPromises()
    expect(config.calendars.feeds).toHaveLength(1)
    const id = config.calendars.feeds[0].id

    const field = wrapper.findComponent(SecretField)
    await field.vm.$emit('update:model-value', 'webcal://example.com/secret/abc.ics')
    await field.vm.$emit('save')
    await flushPromises()

    expect(secrets().get(calendarKeyId(id))).toBe('https://example.com/secret/abc.ics')
    expect(config.calendars.feeds[0].keyId).toBe(calendarKeyId(id))
    expect(JSON.stringify(config.exportSettings())).not.toContain('example.com/secret')
  })

  it('asks before deleting a calendar, and takes its link out of the keychain', async () => {
    config.calendars = { refreshMinutes: 30, feeds: [{ ...feed, keyId: calendarKeyId('f') }] }
    secrets().set(calendarKeyId('f'), 'https://example.com/secret/family.ics')
    wrapper = mount(CalendarsSettings)
    const trash = wrapper
      .findAllComponents(Icon)
      .find((i) => i.props('tooltip') === 'Delete this calendar')!
    await trash.trigger('click')
    const confirm = wrapper.findComponent(ConfirmModal)
    expect(confirm.props('message')).toContain('Family')
    confirm.vm.$emit('confirm')
    await flushPromises()
    expect(config.calendars.feeds).toEqual([])
    expect(secrets().get(calendarKeyId('f'))).toBe('')
  })

  it('shows the CalDAV fields for a CalDAV account', async () => {
    config.calendars = { refreshMinutes: 30, feeds: [{ ...feed, source: 'caldav' }] }
    wrapper = mount(CalendarsSettings)
    expect(wrapper.text()).toContain('Server')
    expect(wrapper.text()).toContain('Username')
    expect(button(wrapper, 'Find calendars').props('disabled')).toBe(true)
  })
})
