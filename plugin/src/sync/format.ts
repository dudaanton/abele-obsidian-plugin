import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

/**
 * The two things the sync screens have to spell out for a person: when something happened, and
 * how large a file is.
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
