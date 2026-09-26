# Logs and journals

Write once, in your journal, and read it later from every note it mentions.

## Logs

A log is a piece of writing that shows up under the notes it mentions. There are two kinds.

**A paragraph in a journal note.** In a note whose `type` is one of the log types (`journal`,
`log` and `daily` by default), every paragraph is a log. Write:

```
Met [[John]] and [[Anna]] at [[Coffee House]], then watched [[Interstellar]].
```

and that paragraph appears, dated, under `John`, `Anna`, `Coffee House` and `Interstellar`.

**A whole note.** A note that points at something through `groups` appears in full under it. This
is how a meeting report, which rarely fits in one paragraph, is written.

Logs also travel up through groups. If `Interstellar` is in the group `Movies`, the `Movies`
note shows every film you watched, with when and with whom.

The log types are set in **Settings → Abele → Logs**. An entry can be a `/regular expression/`
to match notes by path instead.

## Journals

A journal is a set of dated notes: a daily note, a weekly or monthly one, a separate health
diary. Each journal has its own path template, such as `Journals/{{date:YYYY}}/{{date}}`, its own
note template and its own repeat period.

Set them up in **Settings → Abele → Journals**. One journal is the default daily journal: that
is the one **Open today's daily note** opens, creating it from its template if needed.

## The calendar

The timeline sidebar starts with a month calendar. Days with a daily note and days with tasks
are marked. Click a day to open its daily note, which is created if it does not exist yet.
Right-click a day to create a task planned for it, or due on it.
Choose whether the week starts on Monday in **Settings → Abele → Tasks**.

## Other calendars

Events from Google, iCloud, Outlook or any CalDAV calendar can show beside your tasks. They are
only read: nothing is written to those calendars, and no note is made unless you ask for one.
Add them in **Settings → Abele → Calendars**, each with a name and a colour, in one of two ways:

- **Secret link.** Google: the calendar's settings on the web, **Integrate calendar**, **Secret
  address in iCal format**. iCloud: share the calendar as a public calendar and copy its link;
  a `webcal://` link can be pasted as it is. Outlook: publish the calendar and copy the ICS link.
  Anyone with the link can read the calendar, so it is kept in the device's keychain.
  A public Google calendar's embed or share link (`calendar/embed?src=…`, `?cid=…`) works too:
  it is turned into that calendar's public iCal feed, and an embed link showing several
  calendars adds each as a calendar of its own. A private calendar has no public feed, so for
  one of your own use the secret address. A link that is not taken says why under the field.
- **CalDAV account.** The server, the username and a password. For iCloud the server is
  `https://caldav.icloud.com`, the username is your Apple Account email, and the password is an
  app-specific password made at account.apple.com. **Find calendars** lists the account's
  calendars; pick one or keep them all.

Events show in the month calendar as a short bar in the calendar's colour, in the timeline from
today on among the tasks of each day, and in a daily note beside that day's tasks. An event has
no checkbox. Click it for **Create meeting note**, which makes a note about it tied to that day
and opens it; choosing it again opens the same note.

Calendars are read when Obsidian starts, every half hour by default, and with **Read now**. The
last copy is kept on the device, so the events still show without a network. The link and the
password travel to another device with your other keys, see [Transfer and keys](transfer).

## Adding to a journal from outside

Another app can add text to today's note through a link:

```
obsidian://abele?daily&journal=Daily&data=Hello
```

See [Links](scripts#links) for named links that run a script or a command.
