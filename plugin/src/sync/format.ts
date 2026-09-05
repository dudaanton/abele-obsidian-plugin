import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

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
  if (iso === null || iso === '') return 'never'
  const at = dayjs(iso)
  return at.isValid() ? at.fromNow() : 'never'
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
