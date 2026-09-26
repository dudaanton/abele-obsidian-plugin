/**
 * The external calendars' settings, kept under `calendars` in the plugin's settings.
 *
 * What makes a calendar readable — the secret link, or the CalDAV password — is in the
 * keychain, never here: a feed holds only the id it is stored under (`keyId`, a name the
 * agent's settings tools already treat as a secret).
 */
import { nanoid } from 'nanoid'
import { isKitColor, type KitColor } from '@/constants/colors'
import { keychainId } from '@/secrets/keychainId'

export { calendarLinks, normalizeCalendarUrl } from './links'

export type CalendarSource = 'ics' | 'caldav'

export interface CalendarFeed {
  id: string
  /** What the calendar is called in the lists. */
  name: string
  /** Its events' colour, from the kit's named colours so it follows the theme. */
  color: KitColor
  /** Off keeps it configured without reading or showing it. */
  enabled: boolean
  source: CalendarSource
  /** The keychain id of the link (`ics`) or of the password (`caldav`). */
  keyId: string
  /** CalDAV: the server's address — `https://caldav.icloud.com`, say. */
  server: string
  /** CalDAV: the account's login. */
  username: string
  /** CalDAV: the one calendar of the account to show; empty shows every calendar it has. */
  calendarUrl: string
}

export interface CalendarSettings {
  /** How often the calendars are read again while Obsidian is open, in minutes. */
  refreshMinutes: number
  feeds: CalendarFeed[]
}

export const MIN_REFRESH_MINUTES = 5
export const DEFAULT_REFRESH_MINUTES = 30

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  refreshMinutes: DEFAULT_REFRESH_MINUTES,
  feeds: [],
}

/** The keychain id a feed's secret is stored under. */
export const calendarKeyId = (feedId: string) => keychainId('abele-calendar', feedId)

/** Colours handed to new calendars in turn, so two new ones do not look alike. */
const NEW_COLORS: KitColor[] = [
  'blue',
  'green',
  'purple',
  'orange',
  'cyan',
  'pink',
  'red',
  'yellow',
]

export function newFeed(existing: CalendarFeed[]): CalendarFeed {
  const used = new Set(existing.map((f) => f.color))
  const color =
    NEW_COLORS.find((c) => !used.has(c)) ?? NEW_COLORS[existing.length % NEW_COLORS.length]
  return {
    id: nanoid(8),
    name: '',
    color,
    enabled: true,
    source: 'ics',
    keyId: '',
    server: '',
    username: '',
    calendarUrl: '',
  }
}

const str = (value: unknown) => (typeof value === 'string' ? value : '')

function feedFrom(raw: unknown): CalendarFeed | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r.id).trim()
  if (!id) return null
  return {
    id,
    name: str(r.name),
    color: isKitColor(r.color) && r.color !== 'grey' ? r.color : 'blue',
    enabled: r.enabled !== false,
    source: r.source === 'caldav' ? 'caldav' : 'ics',
    keyId: str(r.keyId),
    server: str(r.server).trim(),
    username: str(r.username).trim(),
    calendarUrl: str(r.calendarUrl).trim(),
  }
}

/** The settings as the file, another device or an agent left them, made whole. */
export function calendarSettingsFrom(stored?: unknown): CalendarSettings {
  const raw = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>
  const minutes = Number(raw.refreshMinutes)
  const seen = new Set<string>()
  const feeds = (Array.isArray(raw.feeds) ? raw.feeds : [])
    .map(feedFrom)
    .filter((f): f is CalendarFeed => !!f && !seen.has(f.id) && !!seen.add(f.id))
  return {
    refreshMinutes: Number.isFinite(minutes)
      ? Math.max(MIN_REFRESH_MINUTES, Math.round(minutes))
      : DEFAULT_REFRESH_MINUTES,
    feeds,
  }
}

/** What a feed is called when it has no name of its own. */
export const feedLabel = (feed: CalendarFeed) =>
  feed.name.trim() || (feed.source === 'caldav' ? 'CalDAV calendar' : 'Calendar')
