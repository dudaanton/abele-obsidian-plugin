import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import type { VersionInfo } from '@abele/sync-sdk/protocol'
import type { SyncState } from './status'
import { currentLocale, relativeFormatter, t } from '@/i18n'

/**
 * The three things the sync screens have to spell out for a person: when something happened,
 * how large a file is, and what went wrong.
 *
 * Only the first is here. Sizes are humanised by `formatBytes` in `@/helpers/reduceImage`,
 * which the gallery and the media commands already use — a second one under this folder would
 * mean the same number written two ways in one settings window.
 *
 * Times are dayjs rather than Obsidian's `moment`, which the plan named: this plugin bundles
 * dayjs already and formats every other date in it, so `moment` would be a second date library
 * in the bundle for one line — and Obsidian's export types as a namespace, which is not
 * callable under this project's `esModuleInterop`.
 */

dayjs.extend(relativeTime)

/** When it happened, in words a person reads: `2 minutes ago`, or `never` before it has. */
export function formatWhen(iso: string | null): string {
  if (iso === null || iso === '') return t('sync.when.never')
  const at = dayjs(iso)
  if (!at.isValid()) return t('sync.when.never')
  const locale = currentLocale()
  if (locale.language === 'en') return at.fromNow()
  const seconds = (at.valueOf() - Date.now()) / 1000
  const [unit, scale]: [Intl.RelativeTimeFormatUnit, number] =
    Math.abs(seconds) < 60
      ? ['second', 1]
      : Math.abs(seconds) < 3600
        ? ['minute', 60]
        : Math.abs(seconds) < 86400
          ? ['hour', 3600]
          : Math.abs(seconds) < 2592000
            ? ['day', 86400]
            : Math.abs(seconds) < 31536000
              ? ['month', 2592000]
              : ['year', 31536000]
  return relativeFormatter(locale.format, { numeric: 'auto' }).format(
    Math.round(seconds / scale),
    unit
  )
}

/**
 * What a failure says, for a screen to show.
 *
 * Only an `Error` and a plain string are trusted to say anything: `String(value)` on anything
 * else is `[object Object]`, which reads as a bug in this plugin rather than as the server
 * refusing something. A thrown object that is neither is reported as a failure with no reason,
 * which is at least true.
 */
export function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error !== '') return error
  return 'no reason was given'
}

/**
 * What a restore tells the person, given the state sync was left in by the pull that followed
 * it. The restore is a commit on the server; only a pull that ran puts it on this disk, and
 * while sync is paused, offline or failing none did — "restored" would send somebody looking
 * for a file that is not there yet. `done` is the sentence for a pull that ran; `what` names the
 * file as it now stands on the server.
 */
export function restoredNotice(state: SyncState, done: string, what: string): string {
  if (state === 'paused') return t('streamC.570adea191568771', { v1: String(what) })
  if (state === 'offline' || state === 'error') {
    return t('streamC.0ceea3ba34a775a9', { v1: String(what) })
  }
  return done
}

/**
 * Whose version a merge row holds, for the history's card; undefined for any other row.
 *
 * A merge row is written by the device whose change caused it, whatever it kept: a device that
 * joined under "The server wins" shows as having merged, though the bytes are the head's. So
 * the row is read by what it holds — the incoming bytes are its sender's, the head's are the
 * author of `merge.head_version_id`, and anything else is the two merged. A head version older
 * than the page the dialog read leaves nothing to name.
 */
export function mergeLine(version: VersionInfo, page: VersionInfo[]): string | undefined {
  const merge = version.merge
  if (version.op !== 'merge' || merge === null) return undefined
  if (version.sha !== null && version.sha === merge.incoming_sha) {
    return t('streamC.de8e25d3c122e4a8', { v1: String(version.actor.name) })
  }
  const head = page.find((row) => row.version_id === merge.head_version_id)
  if (head === undefined) return undefined
  if (version.sha === head.sha)
    return t('streamC.de8e25d3c122e4a8', { v1: String(head.actor.name) })
  return t('streamC.f6544cc69e87d10f', {
    v1: String(head.actor.name),
    v2: String(version.actor.name),
  })
}
