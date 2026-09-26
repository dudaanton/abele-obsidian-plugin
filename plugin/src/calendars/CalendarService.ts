/**
 * The external calendars while Obsidian runs: what each one last said, when, and what went
 * wrong if the last try failed.
 *
 * Everything read is kept on the device in `calendars-cache.json` in the plugin's folder, so at
 * startup the lists show the calendars as they were before any network, and a calendar that
 * cannot be reached keeps showing what it said last. That file is a cache — deleting it loses
 * nothing the next read does not bring back — and it is not the settings file, so it neither
 * travels in a transfer nor makes other devices reload when it changes.
 *
 * Calendars are read when the layout is ready, every `refreshMinutes` after that, when their
 * settings change, and when asked to from the settings screen.
 */
import { markRaw, reactive } from 'vue'
import type { CalendarEvent } from './events'
import { compareEvents, eventDays } from './events'
import { readFeed } from './fetch'
import type { Requester } from './http'
import type { TimeWindow } from './ics'
import type { CalendarFeed, CalendarSettings } from './settings'

/** How far back and ahead a calendar is unrolled. */
export const DAYS_BACK = 31
export const DAYS_AHEAD = 183
const DAY_MS = 24 * 60 * 60 * 1000

export interface FeedStatus {
  /** When it was last read successfully, in milliseconds; null when it never was. */
  at: number | null
  /** Why the last try failed; null when it did not. */
  error: string | null
  reading: boolean
}

export interface CalendarState {
  /** Each calendar's events, kept out of Vue's reach: thousands of them, never edited. */
  events: Record<string, CalendarEvent[]>
  status: Record<string, FeedStatus>
  /** Moves whenever the events change, for anything that indexes them. */
  version: number
}

export interface CalendarStorage {
  read(): Promise<string | null>
  write(text: string): Promise<void>
}

interface CachedFeed {
  /** What the feed's source was when this was read: a changed link does not show old events. */
  fingerprint: string
  at: number
  etag?: string
  events: CalendarEvent[]
}

interface CacheFile {
  version: 1
  feeds: Record<string, CachedFeed>
}

export interface CalendarDeps {
  storage: CalendarStorage | null
  request: Requester
  settings: () => CalendarSettings
  secret: (keyId: string) => string
  now?: () => number
}

/** An event with the calendar it came from, for its colour and name. */
export interface ShownEvent {
  event: CalendarEvent
  feed: CalendarFeed
}

/** FNV-1a: enough to notice a changed link without keeping the link. */
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export class CalendarService {
  readonly state = reactive<CalendarState>({ events: {}, status: {}, version: 0 })

  private cache: CacheFile = { version: 1, feeds: {} }
  private loaded: Promise<void> | null = null
  private lastRefresh = 0
  /** The source each calendar was last tried with, so a failing one is not retried on every save. */
  private readonly tried = new Map<string, string>()
  private readonly now: () => number

  constructor(private readonly deps: CalendarDeps) {
    this.now = deps.now ?? (() => Date.now())
  }

  window(): TimeWindow {
    const today = new Date(this.now())
    today.setHours(0, 0, 0, 0)
    return {
      from: today.getTime() - DAYS_BACK * DAY_MS,
      to: today.getTime() + DAYS_AHEAD * DAY_MS,
    }
  }

  private fingerprint(feed: CalendarFeed): string {
    const secret = feed.keyId ? this.deps.secret(feed.keyId) : ''
    return hash([feed.source, feed.server, feed.username, feed.calendarUrl, secret].join('\n'))
  }

  /** The events kept on the device, shown before anything is read. */
  load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const text = await this.deps.storage?.read()
        const parsed = text ? (JSON.parse(text) as CacheFile) : null
        if (parsed?.version === 1 && parsed.feeds && typeof parsed.feeds === 'object') {
          this.cache = parsed
        }
      } catch (e) {
        console.debug('[Abele] calendars: the kept events could not be read', e)
      }
      for (const feed of this.deps.settings().feeds) {
        const kept = this.cache.feeds[feed.id]
        if (!kept || kept.fingerprint !== this.fingerprint(feed)) continue
        this.state.events[feed.id] = markRaw(kept.events)
        this.statusOf(feed.id).at = kept.at
      }
      this.state.version++
    })()
    return this.loaded
  }

  private statusOf(feedId: string): FeedStatus {
    this.state.status[feedId] ??= { at: null, error: null, reading: false }
    return this.state.status[feedId]
  }

  /** Reads every shown calendar, or the ones named, and keeps what came back. */
  async refresh(feedIds?: string[]): Promise<void> {
    await this.load()
    this.lastRefresh = this.now()
    const feeds = this.deps
      .settings()
      .feeds.filter((f) => f.enabled && (!feedIds || feedIds.includes(f.id)))
    await Promise.all(feeds.map((feed) => this.refreshFeed(feed)))
    this.forgetRemoved()
    await this.save()
  }

  private async refreshFeed(feed: CalendarFeed): Promise<void> {
    const status = this.statusOf(feed.id)
    if (status.reading) return
    status.reading = true
    const fingerprint = this.fingerprint(feed)
    this.tried.set(feed.id, fingerprint)
    const kept = this.cache.feeds[feed.id]
    const sameSource = kept?.fingerprint === fingerprint
    try {
      const secret = feed.keyId ? this.deps.secret(feed.keyId) : ''
      const read = await readFeed(
        feed,
        secret,
        this.window(),
        this.deps.request,
        sameSource ? kept?.etag : undefined
      )
      const at = this.now()
      const events = read.unchanged && kept ? kept.events : read.events
      this.cache.feeds[feed.id] = { fingerprint, at, etag: read.etag, events }
      this.state.events[feed.id] = markRaw(events)
      status.at = at
      status.error = null
    } catch (e) {
      status.error = (e as Error)?.message ?? String(e)
      // A different link that fails shows nothing, not the old calendar's events.
      if (!sameSource) {
        delete this.state.events[feed.id]
        status.at = null
      }
      console.debug(`[Abele] calendars: ${feed.name || feed.id} could not be read`, e)
    } finally {
      status.reading = false
      this.state.version++
    }
  }

  /** Calendars deleted from the settings take their kept events with them. */
  private forgetRemoved(): boolean {
    const ids = new Set(this.deps.settings().feeds.map((f) => f.id))
    let removed = false
    for (const id of Object.keys(this.cache.feeds)) {
      if (!ids.has(id)) {
        delete this.cache.feeds[id]
        removed = true
      }
    }
    for (const id of Object.keys(this.state.events)) if (!ids.has(id)) delete this.state.events[id]
    for (const id of Object.keys(this.state.status)) if (!ids.has(id)) delete this.state.status[id]
    return removed
  }

  private async save(): Promise<void> {
    try {
      await this.deps.storage?.write(JSON.stringify(this.cache))
    } catch (e) {
      console.debug('[Abele] calendars: the events could not be kept', e)
    }
  }

  /** Whether `refreshMinutes` have passed since the last read; asked by the plugin's timer. */
  due(): boolean {
    const minutes = this.deps.settings().refreshMinutes
    return this.now() - this.lastRefresh >= minutes * 60 * 1000
  }

  /** Reads again only the calendars whose source changed since they were last read. */
  async refreshChanged(): Promise<void> {
    await this.load()
    const changed = this.deps.settings().feeds.filter((f) => {
      if (!f.enabled) return false
      const now = this.fingerprint(f)
      return this.cache.feeds[f.id]?.fingerprint !== now && this.tried.get(f.id) !== now
    })
    const removed = this.forgetRemoved()
    this.state.version++
    if (changed.length) await this.refresh(changed.map((f) => f.id))
    else if (removed) await this.save()
  }

  /** Every shown event, filed under each day it is on, in the order a day lists them. */
  byDay(): Map<string, ShownEvent[]> {
    void this.state.version
    const days = new Map<string, ShownEvent[]>()
    for (const feed of this.deps.settings().feeds) {
      if (!feed.enabled) continue
      for (const event of this.state.events[feed.id] ?? []) {
        for (const day of eventDays(event)) {
          const list = days.get(day) ?? []
          list.push({ event, feed })
          days.set(day, list)
        }
      }
    }
    for (const list of days.values()) list.sort((a, b) => compareEvents(a.event, b.event))
    return days
  }
}

let service: CalendarService | null = null

/** The one service; one with nothing behind it until the plugin has made its own, as in tests. */
export function calendars(): CalendarService {
  service ??= new CalendarService({
    storage: null,
    request: () => Promise.reject(new Error('Calendars are not started.')),
    settings: () => ({ refreshMinutes: 30, feeds: [] }),
    secret: () => '',
  })
  return service
}

export function setCalendars(next: CalendarService | null): void {
  service = next
}
