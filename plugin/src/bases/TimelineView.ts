import {
  BasesView,
  Keymap,
  NullValue,
  getLanguage,
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
import type { KitColor } from '@/constants/colors'
import { coverLink, resourceUrl } from '@/helpers/resourceUrl'
import { todayPoint, type HistLang } from './historyDates'
import { placeGroups, toTimelineItem, type TimelineItem } from './timelineLayout'

export const TIMELINE_VIEW_ID = 'abele-timeline'
export const TIMELINE_ID_ATTR = 'abele-timeline-base-id'

/** The options of the view, by the keys they are stored under in the `.base` file. */
export const TIMELINE_OPTION = {
  start: 'startProperty',
  end: 'endProperty',
  period: 'periodProperty',
  kind: 'kindProperty',
  cover: 'coverProperty',
  weight: 'weightProperty',
  eras: 'eraGroup',
  approx: 'aboutYears',
} as const

/**
 * The properties read when the view names none, first found wins, per note — so people with
 * `born`, wars with `start` and battles with `date` sit in one base without any setup.
 */
export const TIMELINE_GUESS = {
  start: [
    'start',
    'born',
    'birth',
    'date',
    'year',
    'from',
    'begin',
    'начало',
    'рождение',
    'родился',
    'дата',
    'год',
  ],
  end: ['end', 'died', 'death', 'until', 'to', 'конец', 'смерть', 'умер'],
  period: ['period', 'years', 'lifespan', 'dates', 'период', 'годы', 'годы жизни'],
  kind: ['kind', 'вид'],
  cover: ['cover', 'image', 'portrait', 'photo', 'обложка', 'портрет'],
} as const

/** A start read from one of these is a birth: without an end, the note is a life. */
const BIRTH_KEYS = new Set(['born', 'birth', 'рождение', 'родился'])

export const DEFAULT_ABOUT_YEARS = 5

export interface TimelineLane {
  label: string
  color: KitColor | null
  /** Notes in it that have a date. */
  count: number
}

/** What the Vue side draws from; one per open timeline, teleported into by element. */
export interface TimelineBaseInstance {
  id: string
  el: HTMLElement
  items: ShallowRef<readonly TimelineItem[]>
  lanes: ShallowRef<readonly TimelineLane[]>
  /** Notes the base found with no date the timeline can read. */
  undated: Ref<number>
  /** False when the start is a formula: nothing can be written into it. */
  canCreate: Ref<boolean>
  lang: Ref<HistLang>
  open(item: TimelineItem, event: MouseEvent | KeyboardEvent | null): void
  hover(item: TimelineItem, event: MouseEvent, target: HTMLElement): void
  /** A new note at a person's year (…, -1, 1, …), through the base's own new-note flow. */
  create(year: number): void
}

export function timelineViewOptions(): BasesAllOptions[] {
  const property = (key: string, displayName: string, placeholder: string) => ({
    key,
    type: 'property' as const,
    displayName,
    placeholder,
  })
  return [
    property(TIMELINE_OPTION.start, 'Start', 'Guessed: start, born, date, year…'),
    property(TIMELINE_OPTION.end, 'End', 'Guessed: end, died…'),
    property(TIMELINE_OPTION.period, 'Period', 'A whole span in one field — guessed: period'),
    property(TIMELINE_OPTION.kind, 'Kind', 'Optional — person, event, period or era'),
    property(TIMELINE_OPTION.cover, 'Picture', 'Guessed: cover'),
    property(TIMELINE_OPTION.weight, 'Importance', 'Optional — who is labelled first'),
    {
      key: TIMELINE_OPTION.eras,
      type: 'text' as const,
      displayName: 'Eras group',
      placeholder: 'The group drawn behind as eras — guessed: era, эпоха',
    },
    {
      key: TIMELINE_OPTION.approx,
      type: 'slider' as const,
      displayName: 'Years in "about"',
      default: DEFAULT_ABOUT_YEARS,
      min: 1,
      max: 50,
      step: 1,
    },
  ]
}

/** The frontmatter key behind a property id; null for a formula or a file property. */
function noteKey(prop: BasesPropertyId | null): string | null {
  if (!prop) return null
  const parsed = parsePropertyId(prop)
  return parsed.type === 'note' ? parsed.name : null
}

/** A value as the parser reads it: nothing for an empty one, the text of anything else. */
function raw(entry: BasesEntry, prop: BasesPropertyId): string | null {
  const value = entry.getValue(prop)
  if (value == null || value instanceof NullValue) return null
  const text = value.toString()
  return text.trim() ? text : null
}

/** The first property of `props` the note has a value in, with the key it came from. */
function first(entry: BasesEntry, props: readonly BasesPropertyId[]): [string, string] | null {
  for (const prop of props) {
    const value = raw(entry, prop)
    if (value !== null) return [value, prop]
  }
  return null
}

const guessed = (keys: readonly string[]) => keys.map((k) => `note.${k}` as BasesPropertyId)

/** The view's own property, or the guesses when it names none. */
function propsOf(
  config: BasesViewConfig,
  key: string,
  guess: readonly string[]
): BasesPropertyId[] {
  const chosen = config.getAsPropertyId(key)
  return chosen ? [chosen] : guessed(guess)
}

/** How many notes link to each note, worked out at most every few seconds. */
let incoming: { at: number; counts: Map<string, number> } | null = null
function linkCounts(): Map<string, number> {
  const now = Date.now()
  if (incoming && now - incoming.at < 5000) return incoming.counts
  const counts = new Map<string, number>()
  const resolved = GlobalStore.getInstance().app?.metadataCache?.resolvedLinks ?? {}
  for (const links of Object.values(resolved))
    for (const dest of Object.keys(links)) counts.set(dest, (counts.get(dest) ?? 0) + 1)
  incoming = { at: now, counts }
  return counts
}

const appLanguage = (): HistLang => {
  try {
    return getLanguage().toLowerCase().startsWith('ru') ? 'ru' : 'en'
  } catch {
    return 'en'
  }
}

/**
 * A timeline of history over the notes a base finds: people as bars from birth to death,
 * events as points, eras behind, the base's groups as rows. The drawing is Vue's
 * (`components/timelineBase`), reached through the store like the calendar; this class turns
 * the base's rows into items and does what they ask of Obsidian — open, preview, make a note.
 */
export class TimelineView extends BasesView {
  type = TIMELINE_VIEW_ID
  /** Obsidian's page preview hangs its popover here, as on any hover parent. */
  hoverPopover: HoverPopover | null = null
  private readonly instance: TimelineBaseInstance
  /** The start key the notes use most, for a note made without a start option. */
  private usualStartKey = 'start'

  constructor(controller: QueryController, containerEl: HTMLElement) {
    super(controller)
    const id = nanoid()
    const el = containerEl.createDiv({ attr: { [TIMELINE_ID_ATTR]: id } })
    el.addClass('abele-timeline-base-host')
    this.instance = {
      id,
      el,
      items: shallowRef([]),
      lanes: shallowRef([]),
      undated: ref(0),
      canCreate: ref(true),
      lang: ref(appLanguage()),
      open: (item, event) => {
        void this.app.workspace.openLinkText(
          item.path,
          '',
          event ? Keymap.isModEvent(event) : false
        )
      },
      hover: (item, event, target) => {
        this.app.workspace.trigger('hover-link', {
          event,
          source: 'bases',
          hoverParent: this,
          targetEl: target,
          linktext: item.path,
          sourcePath: '',
        })
      },
      create: (year) => this.create(year),
    }
    const store = GlobalStore.getInstance()
    const map = new Map(store.timelineBaseInstances.value)
    map.set(this.instance.id, this.instance)
    store.timelineBaseInstances.value = map
  }

  onDataUpdated(): void {
    const config = this.config
    const about = Number(config.get(TIMELINE_OPTION.approx))
    const opts = {
      approx: Number.isFinite(about) && about > 0 ? about : DEFAULT_ABOUT_YEARS,
      now: todayPoint(),
    }
    const starts = propsOf(config, TIMELINE_OPTION.start, TIMELINE_GUESS.start)
    const ends = propsOf(config, TIMELINE_OPTION.end, TIMELINE_GUESS.end)
    const periods = propsOf(config, TIMELINE_OPTION.period, TIMELINE_GUESS.period)
    const kinds = propsOf(config, TIMELINE_OPTION.kind, TIMELINE_GUESS.kind)
    const covers = propsOf(config, TIMELINE_OPTION.cover, TIMELINE_GUESS.cover)
    const weightProp = config.getAsPropertyId(TIMELINE_OPTION.weight)
    const chosenStart = config.getAsPropertyId(TIMELINE_OPTION.start)
    this.instance.canCreate.value = !chosenStart || noteKey(chosenStart) !== null
    this.instance.lang.value = appLanguage()

    // The base's groups are the rows; the one named as eras (or called so) is drawn behind.
    const eraOption = config.get(TIMELINE_OPTION.eras)
    const eraName = typeof eraOption === 'string' ? eraOption.trim().toLowerCase() : ''
    const grouped = this.data.groupedData
    const lanes: TimelineLane[] = []
    const placeOf = new Map<BasesEntry, { lane: number; color: KitColor | null; era: boolean }>()
    const labelOf = (key: { toString(): string } | null | undefined) =>
      key == null || key instanceof NullValue ? 'None' : key.toString() || 'None'
    const places = placeGroups(
      grouped.map((g) => labelOf(g.key)),
      eraName
    )
    grouped.forEach((group, i) => {
      const place = places[i]
      if (place.lane >= lanes.length && !place.era)
        lanes.push({ label: place.label, color: place.color, count: 0 })
      for (const entry of group.entries) placeOf.set(entry, place)
    })
    if (!lanes.length) lanes.push({ label: '', color: null, count: 0 })

    const links = weightProp ? null : linkCounts()
    const items: TimelineItem[] = []
    const startKeys = new Map<string, number>()
    let undated = 0
    for (const entry of this.data.data) {
      const path = entry.file.path
      const start = first(entry, starts)
      const place = placeOf.get(entry) ?? { lane: 0, color: null, era: false }
      const startKey = start ? (noteKey(start[1] as BasesPropertyId) ?? '') : ''
      const coverText = first(entry, covers)?.[0]
      const link = coverText ? coverLink(coverText) : null
      const weight = weightProp ? Number(raw(entry, weightProp)) || 0 : (links?.get(path) ?? 0)
      const item = toTimelineItem(
        {
          path,
          title: entry.file.basename,
          start: start?.[0] ?? null,
          end: first(entry, ends)?.[0] ?? null,
          period: first(entry, periods)?.[0] ?? null,
          kind: first(entry, kinds)?.[0] ?? null,
          born: BIRTH_KEYS.has(startKey.toLowerCase()),
          era: place.era,
          lane: Math.max(0, place.lane),
          color: place.color,
          weight,
          cover: link ? (resourceUrl(link, path) ?? null) : null,
        },
        opts
      )
      if (!item) {
        undated++
        continue
      }
      if (startKey) startKeys.set(startKey, (startKeys.get(startKey) ?? 0) + 1)
      if (item.kind !== 'era') lanes[item.lane].count++
      items.push(item)
    }
    let best = 0
    for (const [key, n] of startKeys)
      if (n > best) {
        best = n
        this.usualStartKey = key
      }
    // A group with nothing dated in it — the base file itself, notes without a date — is no row.
    const kept = lanes.filter((l) => l.count > 0 || lanes.length === 1)
    const index = new Map(lanes.map((l, i) => [i, Math.max(0, kept.indexOf(l))]))
    for (const item of items) item.lane = index.get(item.lane) ?? 0
    this.instance.items.value = items.map((item) => Object.freeze(item))
    this.instance.lanes.value = kept.length ? kept : lanes.slice(0, 1)
    this.instance.undated.value = undated
  }

  onunload(): void {
    const store = GlobalStore.getInstance()
    const map = new Map(store.timelineBaseInstances.value)
    map.delete(this.instance.id)
    store.timelineBaseInstances.value = map
  }

  /**
   * Obsidian's own new-note flow for the view — the note it makes already meets what it can of
   * the base's filters — with the year written into the start on top: as a number, which is
   * what a person would type, negative before Christ.
   */
  private create(year: number): void {
    const chosen = this.config.getAsPropertyId(TIMELINE_OPTION.start)
    const key = chosen ? noteKey(chosen) : this.usualStartKey
    if (!key) return
    void this.createFileForView(undefined, (frontmatter: Record<string, unknown>) => {
      frontmatter[key] = year
    })
  }
}
