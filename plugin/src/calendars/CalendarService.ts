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
import { sourceHash } from './credentialGenerations'
import { markRaw, reactive } from 'vue'
import type { CalendarEvent } from './events'
import { EventCompletionStore } from './completion'
import { compareEvents, eventDays, refreshedOccurrence } from './events'
import { readFeed } from './fetch'
import type { Requester } from './http'
import { parseIcs, type TimeWindow } from './ics'
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
  ics?: string
  events: CalendarEvent[]
}

interface CacheFile {
  version: 2
  feeds: Record<string, CachedFeed>
}

export interface CalendarDeps {
  storage: CalendarStorage | null
  request: Requester
  settings: () => CalendarSettings
  secret: (keyId: string) => string
  /** Persistent per-credential counter supplied by the keychain adapter. */
  credentialGeneration?: (keyId: string) => number
  now?: () => number
  completion?: EventCompletionStore
  /** Removed-feed marks also age out; supplied by the synced storage adapter. */
  markedFeeds?: () => string[]
}

/** An event with the calendar it came from, for its colour and name. */
export interface ShownEvent {
  event: CalendarEvent
  feed: CalendarFeed
}

// In-memory storage adapters can share a credential clock across service recreation. The
// running plugin supplies its persistent keychain clock instead; no credential goes to disk.
const memoryCredentials = new WeakMap<
  CalendarStorage,
  Map<string, { value: string; generation: number }>
>()

export class CalendarService {
  readonly state = reactive<CalendarState>({ events: {}, status: {}, version: 0 })

  private cache: CacheFile = { version: 2, feeds: {} }
  private readonly credentials: Map<string, { value: string; generation: number }>
  private loaded: Promise<void> | null = null
  private lastRefresh = 0
  private readonly inFlight = new Map<string, Promise<void>>()
  /** The source each calendar was last tried with, so a failing one is not retried on every save. */
  private readonly tried = new Map<string, string>()
  private readonly now: () => number

  constructor(private readonly deps: CalendarDeps) {
    this.now = deps.now ?? (() => Date.now())
    this.credentials = (deps.storage && memoryCredentials.get(deps.storage)) ?? new Map()
    if (deps.storage) memoryCredentials.set(deps.storage, this.credentials)
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
    const id = feed.keyId
    let generation = this.deps.credentialGeneration?.(id)
    if (generation === undefined) {
      const value = id ? this.deps.secret(id) : ''
      const previous = this.credentials.get(id)
      generation = previous?.value === value ? previous.generation : (previous?.generation ?? 0) + 1
      this.credentials.set(id, { value, generation })
    }
    return sourceHash(
      JSON.stringify([feed.source, feed.server, feed.username, feed.calendarUrl, id, generation])
    )
  }

  /** The events kept on the device, shown before anything is read. */
  load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const text = await this.deps.storage?.read()
        const parsed = text ? (JSON.parse(text) as CacheFile) : null
        if (parsed?.version === 2 && parsed.feeds && typeof parsed.feeds === 'object') {
          this.cache = parsed
        } else if (parsed) {
          // Discard and overwrite password-derived legacy fingerprints even for disabled feeds.
          await this.save()
        }
      } catch (e) {
        console.debug('[Abele] calendars: the kept events could not be read', e)
      }
      for (const feed of this.deps.settings().feeds) {
        const kept = this.cache.feeds[feed.id]
        if (!kept || kept.fingerprint !== this.fingerprint(feed)) continue
        this.state.events[feed.id] = markRaw(
          kept.ics ? parseIcs(kept.ics, feed.id, this.window()) : kept.events
        )
        this.statusOf(feed.id).at = kept.at
      }
      await this.pruneRemovedMarks()
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
    await this.pruneRemovedMarks()
    await this.save()
  }

  private refreshFeed(feed: CalendarFeed): Promise<void> {
    const pending = this.inFlight.get(feed.id)
    if (pending)
      return pending.then(() => {
        if (this.tried.get(feed.id) !== this.fingerprint(feed)) return this.refreshFeed(feed)
      })
    const reading = this.readFeedNow(feed).finally(() => this.inFlight.delete(feed.id))
    this.inFlight.set(feed.id, reading)
    return reading
  }

  private async readFeedNow(feed: CalendarFeed): Promise<void> {
    const status = this.statusOf(feed.id)
    status.reading = true
    const fingerprint = this.fingerprint(feed)
    this.tried.set(feed.id, fingerprint)
    const kept = this.cache.feeds[feed.id]
    const sameSource = kept?.fingerprint === fingerprint
    if (!sameSource) {
      delete this.state.events[feed.id]
      status.at = null
    }
    try {
      if (sameSource && kept.ics) {
        this.state.events[feed.id] = markRaw(parseIcs(kept.ics, feed.id, this.window()))
      }
      const secret = feed.keyId ? this.deps.secret(feed.keyId) : ''
      const read = await readFeed(
        feed,
        secret,
        this.window(),
        this.deps.request,
        // Old event-only caches need one full read before an unchanged response is useful.
        sameSource && kept.ics ? kept.etag : undefined
      )
      if (this.fingerprint(feed) !== fingerprint) return
      const at = this.now()
      const ics = read.unchanged ? kept?.ics : read.ics
      const events = read.unchanged && ics ? parseIcs(ics, feed.id, this.window()) : read.events
      this.cache.feeds[feed.id] = {
        fingerprint,
        at,
        etag: read.etag,
        events,
        ...(ics ? { ics } : {}),
      }
      this.state.events[feed.id] = markRaw(events)
      status.at = at
      status.error = null
      try {
        await this.deps.completion?.reconcile(feed.id, events, at)
      } catch (e) {
        console.debug('[Abele] calendars: completion marks could not be kept', e)
      }
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

  /** Removed calendars age out even when there is no enabled calendar left to refresh. */
  async pruneRemovedMarks(): Promise<void> {
    const configured = new Set(this.deps.settings().feeds.map((f) => f.id))
    try {
      for (const id of this.deps.markedFeeds?.() ?? []) {
        if (!configured.has(id)) await this.deps.completion?.reconcile(id, [], this.now())
      }
    } catch (e) {
      console.debug('[Abele] calendars: removed completion marks could not be pruned', e)
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
    await this.pruneRemovedMarks()
    this.state.version++
    if (changed.length) await this.refresh(changed.map((f) => f.id))
    else if (removed) await this.save()
  }

  eventById(id: string): CalendarEvent | undefined {
    for (const events of Object.values(this.state.events)) {
      const found = events.find((e) => e.id === id)
      if (found) return found
    }
  }

  isDone(event: CalendarEvent): boolean {
    void this.state.version
    return this.deps.completion?.isDone(event) ?? false
  }

  async setDone(event: CalendarEvent, done: boolean): Promise<void> {
    if (!this.deps.completion) throw new Error('Calendar completion is not started.')
    // Older caches hold expanded events but not their source occurrence identity. Never
    // guess a series mark from those: a full source read supplies the original start.
    if (event.recurrenceId === undefined) {
      await this.refresh([event.feedId])
      const refreshed = refreshedOccurrence(event, this.state.events[event.feedId] ?? [])
      if (!refreshed || refreshed.recurrenceId === undefined)
        throw new Error('The calendar must be refreshed before this occurrence can be marked.')
      event = refreshed
    }
    await this.deps.completion.setDone(event, done, this.now())
    this.state.version++
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
