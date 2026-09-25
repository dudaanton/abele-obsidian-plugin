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

## Adding to a journal from outside

Another app can add text to today's note through a link:

```
obsidian://abele?daily&journal=Daily&data=Hello
```

See [Links](scripts#links) for named links that run a script or a command.
