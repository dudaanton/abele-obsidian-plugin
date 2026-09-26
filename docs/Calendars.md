# Calendars

Abele can show the events of other calendars — Google, iCloud, Outlook, Fastmail, Nextcloud,
anything that publishes a calendar link or speaks CalDAV — beside the tasks: in the month
calendar of the sidebar, in the timeline under it, and in a daily note's list of that day's tasks.
It reads only. Nothing is written to a calendar, and no note is made from an event unless you
ask for one. Calendars are added in **Settings → Abele → Calendars**.

## Connecting a calendar

**By its secret link.** Most calendar services hand out a private address of the whole calendar
in iCalendar format. Anyone who has it can read the calendar, so it is kept in the keychain like
any other key, not in the settings file.

| Service | Where the link is |
|---|---|
| Google Calendar | The calendar's settings on the web, *Integrate calendar* → *Secret address in iCal format*. |
| iCloud | In the Calendar app, share the calendar as a *Public Calendar* and copy its link. It starts with `webcal://`; paste it as it is. |
| Outlook / Microsoft 365 | *Settings → Calendar → Shared calendars → Publish a calendar*, then the ICS link. A work account may not allow publishing. |

**By a CalDAV account.** The server's address, the username and a password. For iCloud the
server is `https://caldav.icloud.com`, the username is the Apple Account's email and the
password is an *app-specific password* made at account.apple.com — the account's own password is
refused. Such a password opens more than the calendars (mail and contacts too), which is why it
lives in the keychain and never in the settings. *Find calendars* asks the server which calendars
the account has; pick one, or leave *All calendars of the account*. Google's CalDAV needs an OAuth
sign-in and is not supported — use its secret link instead.

Each calendar has a name and a colour, and can be switched off without being deleted.

## What is shown

- **The sidebar calendar** marks a day that has events with a short bar in the colour of its first
  calendar, beside the dot of a daily note and the rings of tasks.
- **The timeline** lists events from today on, among the day's tasks in the order of the day:
  day-long events first, then by time. An event has no checkbox; a bar in its calendar's colour
  stands where a task's checkbox would, and the calendar's name follows the time and the place.
  An event over several days shows on each of them — *From 22:00*, *Until 06:00*, *All day, 2 of 3*.
  With a label filter on, events are hidden, since they have no labels; the search finds them by
  title and place.
- **A daily note** lists that day's events with its tasks.

A click on an event offers **Create meeting note** — a note named after the event and the day,
placed where Obsidian puts new notes, with the day's daily note in its `groups` so it shows as a
log there, and the people invited linked when the vault has a note for them. Choosing it again
opens the same note. An event with a link offers to open it too.

## Reading and keeping

Calendars are read when Obsidian starts, every *Read every (minutes)* after that (30 by default),
when a calendar's settings change, and by *Read now*. Each read unrolls repeating events from a
month back to half a year ahead. What was read is kept on the device, in `calendars-cache.json`
in the plugin's folder, so the lists show it at once at startup, and keep showing it when a
calendar cannot be reached; the calendar's card then says what went wrong and how old its events
are. Nothing in the vault depends on that file.

All requests go through Obsidian's own network function, so they work the same on a phone and no
browser rule stands in the way.

## Time

Repeating events are unrolled by [ical.js](https://github.com/kewisch/ical.js), Mozilla's
iCalendar library: repeat rules, dates taken out of a series, a single occurrence moved or
cancelled. Times are read in the zone the calendar gives:

- a zone the file describes (a `VTIMEZONE`) is used as described;
- a zone the file only names — Outlook writes `W. Europe Standard Time` and nothing more — is
  looked up: Windows names through the table Windows and CLDR share, IANA names as they are, and
  the offsets come from the device's own time zone data, clock changes included;
- a time with no zone at all is the device's own clock;
- a day-long event stays on its dates wherever the device is.

A timed event is filed under the days of the device's clock it touches; one ending at midnight
is not on the next day.

## For developers

`plugin/src/calendars/`: `ics.ts` reads and unrolls a calendar, `zones.ts` answers for zones a
file does not describe, `caldav.ts` finds and reads CalDAV calendars (with the small XML reader
in `xml.ts`), `fetch.ts` reads one calendar either way, `CalendarService.ts` holds the events,
the cache and the refresh, and `start.ts` wires it into the plugin. Tests read the fixtures in
`plugin/tests/fixtures/calendars/` and a server started in the test itself
(`plugin/tests/helpers/fakeCalendarServer.ts`), never a real account.
