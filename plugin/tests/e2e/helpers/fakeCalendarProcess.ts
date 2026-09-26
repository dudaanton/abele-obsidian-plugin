/**
 * The calendar server of `tests/helpers/fakeCalendarServer.ts` in a process of its own, for the
 * e2e tier: the test process is blocked while each `obsidian eval` runs, and a server living
 * in it could not answer the requests that eval makes. Serves the calendar in the file named
 * by its first argument and prints `listening <port>`.
 */
import { readFileSync } from 'node:fs'
import { startFakeCalendarServer } from '../../helpers/fakeCalendarServer'

void startFakeCalendarServer(readFileSync(process.argv[2], 'utf8')).then((server) => {
  console.log(`listening ${new URL(server.origin).port}`)
})
