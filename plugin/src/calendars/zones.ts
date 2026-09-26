/**
 * Time zones a calendar file names but does not describe.
 *
 * A file is meant to carry a VTIMEZONE for every TZID it uses, and ical.js reads those itself.
 * Many do not: Outlook and Exchange publish links that say `TZID=W. Europe Standard Time` and
 * nothing more, and some servers name an IANA zone the same way. Taking such a time as the
 * device's own is what moves other plugins' Outlook events by hours. Here the name is turned
 * into an IANA zone — through the table Windows and CLDR agree on for Windows names — and the
 * platform's own `Intl` knows the rules of every IANA zone, clock changes included.
 */

/**
 * Windows zone names and the IANA zone CLDR gives each for its main territory ("001").
 * Not every Windows zone — the ones a calendar is likely to meet.
 */
const WINDOWS_ZONES: Record<string, string> = {
  'Dateline Standard Time': 'Etc/GMT+12',
  'UTC-11': 'Etc/GMT+11',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time (Mexico)': 'America/Tijuana',
  'Pacific Standard Time': 'America/Los_Angeles',
  'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time (Mexico)': 'America/Mazatlan',
  'Mountain Standard Time': 'America/Denver',
  'Central America Standard Time': 'America/Guatemala',
  'Central Standard Time': 'America/Chicago',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Canada Central Standard Time': 'America/Regina',
  'SA Pacific Standard Time': 'America/Bogota',
  'Eastern Standard Time': 'America/New_York',
  'Eastern Standard Time (Mexico)': 'America/Cancun',
  'US Eastern Standard Time': 'America/Indianapolis',
  'Venezuela Standard Time': 'America/Caracas',
  'Atlantic Standard Time': 'America/Halifax',
  'SA Western Standard Time': 'America/La_Paz',
  'Pacific SA Standard Time': 'America/Santiago',
  'Newfoundland Standard Time': 'America/St_Johns',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Buenos_Aires',
  'SA Eastern Standard Time': 'America/Cayenne',
  'Greenland Standard Time': 'America/Godthab',
  'Montevideo Standard Time': 'America/Montevideo',
  'UTC-02': 'Etc/GMT+2',
  'Azores Standard Time': 'Atlantic/Azores',
  'Cape Verde Standard Time': 'Atlantic/Cape_Verde',
  UTC: 'Etc/UTC',
  'Coordinated Universal Time': 'Etc/UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'Morocco Standard Time': 'Africa/Casablanca',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw',
  'W. Central Africa Standard Time': 'Africa/Lagos',
  'Jordan Standard Time': 'Asia/Amman',
  'GTB Standard Time': 'Europe/Bucharest',
  'Middle East Standard Time': 'Asia/Beirut',
  'Egypt Standard Time': 'Africa/Cairo',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'Syria Standard Time': 'Asia/Damascus',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'FLE Standard Time': 'Europe/Kiev',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Kaliningrad Standard Time': 'Europe/Kaliningrad',
  'Arabic Standard Time': 'Asia/Baghdad',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Arab Standard Time': 'Asia/Riyadh',
  'Belarus Standard Time': 'Europe/Minsk',
  'Russian Standard Time': 'Europe/Moscow',
  'E. Africa Standard Time': 'Africa/Nairobi',
  'Iran Standard Time': 'Asia/Tehran',
  'Arabian Standard Time': 'Asia/Dubai',
  'Azerbaijan Standard Time': 'Asia/Baku',
  'Russia Time Zone 3': 'Europe/Samara',
  'Georgian Standard Time': 'Asia/Tbilisi',
  'Caucasus Standard Time': 'Asia/Yerevan',
  'Afghanistan Standard Time': 'Asia/Kabul',
  'West Asia Standard Time': 'Asia/Tashkent',
  'Ekaterinburg Standard Time': 'Asia/Yekaterinburg',
  'Pakistan Standard Time': 'Asia/Karachi',
  'India Standard Time': 'Asia/Calcutta',
  'Sri Lanka Standard Time': 'Asia/Colombo',
  'Nepal Standard Time': 'Asia/Katmandu',
  'Central Asia Standard Time': 'Asia/Almaty',
  'Bangladesh Standard Time': 'Asia/Dhaka',
  'Omsk Standard Time': 'Asia/Omsk',
  'Myanmar Standard Time': 'Asia/Rangoon',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'N. Central Asia Standard Time': 'Asia/Novosibirsk',
  'North Asia Standard Time': 'Asia/Krasnoyarsk',
  'China Standard Time': 'Asia/Shanghai',
  'North Asia East Standard Time': 'Asia/Irkutsk',
  'Singapore Standard Time': 'Asia/Singapore',
  'W. Australia Standard Time': 'Australia/Perth',
  'Taipei Standard Time': 'Asia/Taipei',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'Yakutsk Standard Time': 'Asia/Yakutsk',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'West Pacific Standard Time': 'Pacific/Port_Moresby',
  'Tasmania Standard Time': 'Australia/Hobart',
  'Vladivostok Standard Time': 'Asia/Vladivostok',
  'Central Pacific Standard Time': 'Pacific/Guadalcanal',
  'Magadan Standard Time': 'Asia/Magadan',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Fiji Standard Time': 'Pacific/Fiji',
  'Tonga Standard Time': 'Pacific/Tongatapu',
}

const valid = new Map<string, boolean>()

function isIanaZone(zone: string): boolean {
  let known = valid.get(zone)
  if (known === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone })
      known = true
    } catch {
      known = false
    }
    valid.set(zone, known)
  }
  return known
}

/**
 * The IANA zone a TZID means, or `null` when it means nothing this device knows.
 *
 * Handles the Windows names, IANA names, and the prefixed form older Mozilla and Lotus exports
 * write (`/mozilla.org/20050126_1/Europe/Berlin`).
 */
export function resolveZone(tzid: string): string | null {
  const name = tzid.trim().replace(/^"|"$/g, '')
  if (!name) return null
  const windows = WINDOWS_ZONES[name]
  if (windows) return windows
  if (isIanaZone(name)) return name
  // The last two segments of a path-like id are an IANA name more often than not.
  const tail = name.split('/').filter(Boolean)
  for (let i = Math.max(0, tail.length - 3); i < tail.length; i++) {
    const candidate = tail.slice(i).join('/')
    if (candidate.includes('/') && isIanaZone(candidate)) return candidate
  }
  return null
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(zone, f)
  }
  return f
}

/** How far the zone's clock is ahead of UTC at this instant, in milliseconds. */
function offsetAt(ms: number, zone: string): number {
  const parts: Record<string, number> = {}
  for (const part of formatter(zone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )
  return wall - Math.floor(ms / 1000) * 1000
}

export interface WallTime {
  year: number
  /** 1–12. */
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/**
 * The instant a clock in `zone` shows this time. A time the clock skips in spring is taken
 * as the same time after the change; one it shows twice in autumn, as the first.
 */
export function wallTimeToInstant(wall: WallTime, zone: string): number {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
  const first = asUtc - offsetAt(asUtc, zone)
  const second = asUtc - offsetAt(first, zone)
  if (first === second) return first
  // Straddling a change: the guess that reads back as the asked wall time is the answer.
  const readsBack = (ms: number) => ms + offsetAt(ms, zone) === asUtc
  if (readsBack(Math.min(first, second))) return Math.min(first, second)
  if (readsBack(Math.max(first, second))) return Math.max(first, second)
  return Math.max(first, second)
}
