# Time tracking

A replacement for Toggl: each stretch of time is a note, and totals add up through groups.

## The timer

On a note you can track time for, a timer button sits in its header. Press it, or run
**Start timer for current note**, and a time entry starts for that note. **Stop active timer**
ends it. Starting a timer stops the one that was running.

Which notes get the button is set in **Settings → Abele → Time Tracking**: tasks by default,
other note types if you add them, or every note.

## Time entries

A time entry is a note with `start`, `end` and `groups` pointing at what the time was spent on.
An entry with no `end` is still running. Where entries are saved is a path template in the
settings.

## Where time shows up

Time tracked against a note appears under it, and adds up through its groups. Time spent on tasks
of a project shows on the project note. **Show time tracking sidebar** opens the running timer,
charts of where the time went over a period you pick, and the entries themselves. It can also
start an empty timer, not tied to any note yet.

For reports, Obsidian's own Bases can list and export time entries.

## Moving from Toggl

**Migrate time entries from Toggl** imports entries from your Toggl account through
Toggl's API.
