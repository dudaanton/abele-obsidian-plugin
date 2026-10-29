/** Inspector discovery is machine-wide; a fixture owns processes by PID, not script basename. */
export function isFixtureProgram(row: { title: string; note: string }, pids: readonly number[]) {
  const pid = /(?:^| · )pid (\d+)(?: · |$)/.exec(row.note)?.[1]
  return pid !== undefined && pids.includes(Number(pid))
}
