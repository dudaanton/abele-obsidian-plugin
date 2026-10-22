/** Formatting options are constant; constructing a formatter per action is expensive. */
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

export function activityTime(at: number): string {
  return clock.format(at)
}
