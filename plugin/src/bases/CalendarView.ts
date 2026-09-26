import {
  BasesView,
  Keymap,
  NullValue,
  parsePropertyId,
  type BasesAllOptions,
  type BasesEntry,
  type BasesPropertyId,
  type BasesViewConfig,
  type HoverPopover,
  type QueryController,
} from 'obsidian'
import { nanoid } from 'nanoid'
import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { KIT_COLORS, type KitColor } from '@/constants/colors'
import {
  CALENDAR_MODES,
  applyMove,
  dayNumber,
  dayOrder,
  newNoteFrontmatter,
  toItem,
  type CalendarItem,
  type CalendarMode,
} from './calendarLayout'

export const CALENDAR_VIEW_ID = 'abele-calendar'
export const CALENDAR_ID_ATTR = 'abele-calendar-base-id'

/** The options of the view, by the keys they are stored under in the `.base` file. */
export const CALENDAR_OPTION = {
  mode: 'mode',
  date: 'dateProperty',
  time: 'timeProperty',
  end: 'endProperty',
  endTime: 'endTimeProperty',
  events: 'showCalendarEvents',
  doneLast: 'doneLast',
} as const

/** The task model's own properties: a base over the tasks folder works with nothing set. */
export const CALENDAR_DEFAULTS = {
  date: 'note.date',
  time: 'note.dateTime',
  end: 'note.due',
  endTime: 'note.dueTime',
} as const

const COMPLETED: BasesPropertyId = 'note.completed'

/** Group colours, in order; grey is left out, it reads as no colour at all. */
const GROUP_COLORS = KIT_COLORS.filter((c) => c !== 'grey')

export interface CalendarGroup {
  label: string
  color: KitColor
}

/** What the Vue side draws from; one per open calendar view, teleported into by element. */
export interface CalendarBaseInstance {
  id: string
  el: HTMLElement
  items: ShallowRef<readonly CalendarItem[]>
  groups: ShallowRef<readonly CalendarGroup[]>
  /** Notes the base found that have no date to be placed by. */
  undated: Ref<number>
  mode: Ref<CalendarMode>
  showEvents: Ref<boolean>
  /** False when the date is a formula: nothing can be written into it. */
  canCreate: Ref<boolean>
  setMode(mode: CalendarMode): void
  open(item: CalendarItem, event: MouseEvent | KeyboardEvent): void
  hover(item: CalendarItem, event: MouseEvent): void
  create(day: string, minute: number | null): void
  /**
   * A note dragged from `from` — the day it was taken from, one of a span's — to another day,
   * or to an hour of one.
   */
  move(item: CalendarItem, from: string, to: string, minute: number | null): void
}

export function calendarViewOptions(): BasesAllOptions[] {
  const property = (key: string, displayName: string, def: string, placeholder: string) => ({
    key,
    type: 'property' as const,
    displayName,
    default: def,
    placeholder,
  })
  return [
    {
      key: CALENDAR_OPTION.mode,
      type: 'dropdown' as const,
      displayName: 'Layout',
      default: 'month',
      options: { month: 'Month', week: 'Week', year: 'Year' },
    },
    property(CALENDAR_OPTION.date, 'Date', CALENDAR_DEFAULTS.date, 'The day a note is on'),
    property(CALENDAR_OPTION.time, 'Time', CALENDAR_DEFAULTS.time, 'Optional — its time'),
    property(CALENDAR_OPTION.end, 'End date', CALENDAR_DEFAULTS.end, 'Optional — the last day'),
    property(
      CALENDAR_OPTION.endTime,
      'End time',
      CALENDAR_DEFAULTS.endTime,
      'Optional — when it ends'
    ),
    {
      key: CALENDAR_OPTION.doneLast,
      type: 'toggle' as const,
      displayName: 'Done tasks last',
      default: true,
    },
    {
      key: CALENDAR_OPTION.events,
      type: 'toggle' as const,
      displayName: 'Show calendar events',
      default: false,
    },
  ]
}

const isMode = (v: unknown): v is CalendarMode =>
  typeof v === 'string' && (CALENDAR_MODES as string[]).includes(v)

/** A property id from the options, the task model's own when the option was never set. */
function propertyOf(config: BasesViewConfig, key: string, fallback: string): BasesPropertyId {
  return config.getAsPropertyId(key) ?? (fallback as BasesPropertyId)
}

/** A value as the layout reads it: nothing for an empty one, the text of anything else. */
function raw(entry: BasesEntry, prop: BasesPropertyId): unknown {
  const value = entry.getValue(prop)
  if (value == null || value instanceof NullValue) return null
  return value.toString()
}

/** The frontmatter key behind a property id; null for a formula or a file property. */
function noteKey(prop: BasesPropertyId | null): string | null {
  if (!prop) return null
  const parsed = parsePropertyId(prop)
  return parsed.type === 'note' ? parsed.name : null
}

/**
 * A calendar of the notes a base finds: month, week and year, placed by a date property. The
 * drawing is Vue's (`components/calendarBase`), reached through the store like the find and
 * replace view; this class only turns the base's rows into items and does what they ask of
 * Obsidian — open a note, preview one, make one.
 */
export class CalendarView extends BasesView {
  type = CALENDAR_VIEW_ID
  /** Obsidian's page preview hangs its popover here, as on any hover parent. */
  hoverPopover: HoverPopover | null = null
  private readonly instance: CalendarBaseInstance

  constructor(controller: QueryController, containerEl: HTMLElement) {
    super(controller)
    const id = nanoid()
    const el = containerEl.createDiv({ attr: { [CALENDAR_ID_ATTR]: id } })
    el.addClass('abele-calendar-base-host')
    this.instance = {
      id,
      el,
      items: shallowRef([]),
      groups: shallowRef([]),
      undated: ref(0),
      mode: ref('month'),
      showEvents: ref(false),
      canCreate: ref(true),
      setMode: (mode) => {
        this.instance.mode.value = mode
        if (this.config.get(CALENDAR_OPTION.mode) !== mode)
          this.config.set(CALENDAR_OPTION.mode, mode)
      },
      open: (item, event) => {
        if (!item.path) return
        void this.app.workspace.openLinkText(item.path, '', Keymap.isModEvent(event))
      },
      hover: (item, event) => {
        if (!item.path) return
        this.app.workspace.trigger('hover-link', {
          event,
          source: 'bases',
          hoverParent: this,
          targetEl: event.currentTarget,
          linktext: item.path,
          sourcePath: '',
        })
      },
      create: (day, minute) => this.create(day, minute),
      move: (item, from, to, minute) => void this.move(item, from, to, minute),
    }
    const store = GlobalStore.getInstance()
    const map = new Map(store.calendarBaseInstances.value)
    map.set(this.instance.id, this.instance)
    store.calendarBaseInstances.value = map
  }

  onDataUpdated(): void {
    const config = this.config
    const mode = config.get(CALENDAR_OPTION.mode)
    if (isMode(mode)) this.instance.mode.value = mode
    this.instance.showEvents.value = !!config.get(CALENDAR_OPTION.events)

    const date = propertyOf(config, CALENDAR_OPTION.date, CALENDAR_DEFAULTS.date)
    const time = propertyOf(config, CALENDAR_OPTION.time, CALENDAR_DEFAULTS.time)
    const end = propertyOf(config, CALENDAR_OPTION.end, CALENDAR_DEFAULTS.end)
    const endTime = propertyOf(config, CALENDAR_OPTION.endTime, CALENDAR_DEFAULTS.endTime)
    this.instance.canCreate.value = noteKey(date) !== null

    // The base's own grouping colours the items; one group, or none, leaves them the accent.
    const grouped = this.data.groupedData
    const groups: CalendarGroup[] = []
    const colorOf = new Map<BasesEntry, KitColor>()
    if (grouped.length > 1) {
      grouped.forEach((group, i) => {
        const color = GROUP_COLORS[i % GROUP_COLORS.length]
        const key = group.key
        const label = key == null || key instanceof NullValue ? 'None' : key.toString() || 'None'
        groups.push({ label, color })
        for (const entry of group.entries) colorOf.set(entry, color)
      })
    }

    // The rows come in the base's sort; when it has one, each day keeps to it. Done tasks go
    // after the rest unless the view says otherwise — the base alone cannot do that: it puts
    // an empty `completed` last whichever way it sorts.
    const sorted = config.getSort().length > 0
    const doneLast = config.get(CALENDAR_OPTION.doneLast) !== false
    const rows = this.data.data
    const items: CalendarItem[] = []
    let undated = 0
    let index = 0
    for (const entry of rows) {
      const completed = raw(entry, COMPLETED) !== null
      const item = toItem({
        path: entry.file.path,
        title: entry.file.basename,
        start: raw(entry, date),
        startTime: raw(entry, time),
        end: raw(entry, end),
        endTime: raw(entry, endTime),
        color: colorOf.get(entry) ?? null,
        completed,
        order: dayOrder({ index: index++, count: rows.length, sorted, doneLast, completed }),
      })
      if (item) items.push(Object.freeze(item))
      else undated++
    }
    this.instance.items.value = items
    this.instance.groups.value = groups
    this.instance.undated.value = undated
  }

  onunload(): void {
    const store = GlobalStore.getInstance()
    const map = new Map(store.calendarBaseInstances.value)
    map.delete(this.instance.id)
    store.calendarBaseInstances.value = map
  }

  /**
   * Writes a drag into the note: its dates moved by as many days as it was carried, and the
   * hour it was let go at, through `processFrontMatter` so nothing else in the note is touched.
   * The base sees the change and draws the note on its new day by itself.
   */
  private async move(
    item: CalendarItem,
    from: string,
    to: string,
    minute: number | null
  ): Promise<void> {
    const shift = dayNumber(to) - dayNumber(from)
    if (item.kind !== 'note' || (shift === 0 && (minute === null || minute === item.startMinute)))
      return
    const file = this.app.vault.getFileByPath(item.path)
    if (!file) return
    const key = (option: string, fallback: string) =>
      noteKey(propertyOf(this.config, option, fallback))
    const keys = {
      dateKey: key(CALENDAR_OPTION.date, CALENDAR_DEFAULTS.date),
      timeKey: key(CALENDAR_OPTION.time, CALENDAR_DEFAULTS.time),
      endKey: key(CALENDAR_OPTION.end, CALENDAR_DEFAULTS.end),
      endTimeKey: key(CALENDAR_OPTION.endTime, CALENDAR_DEFAULTS.endTime),
    }
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      applyMove(frontmatter, keys, item, shift, minute)
    })
  }

  /**
   * Obsidian's own new-note flow for the view — the note it makes already meets what it can of
   * the base's filters — with the day, and the hour when there is one, written on top.
   */
  private create(day: string, minute: number | null): void {
    const date = propertyOf(this.config, CALENDAR_OPTION.date, CALENDAR_DEFAULTS.date)
    const time = propertyOf(this.config, CALENDAR_OPTION.time, CALENDAR_DEFAULTS.time)
    const fields = newNoteFrontmatter(
      { dateKey: noteKey(date), timeKey: noteKey(time) },
      day,
      minute
    )
    if (!fields) return
    void this.createFileForView(undefined, (frontmatter: Record<string, unknown>) => {
      Object.assign(frontmatter, fields)
    })
  }
}
