# Tasks

Tasks are notes: one note per task, with its dates in properties and its description in the body.

## Checklists inside a note

For small lists, keep the items in the note instead of creating task notes. Write a normal
Markdown list with a checkbox, using any of these states:

| Marker | State | Symbol |
|---|---|---|
| `[ ]` | Open | Empty square |
| `[/]` | In progress | Slash |
| `[x]` | Done | Check |
| `[-]` | Cancelled | Minus |
| `[>]` | Forwarded | Right arrow |
| `[<]` | Scheduled | Calendar |
| `[?]` | Question | Question mark |
| `[!]` | Important | Exclamation mark |

For example, `- [/] Draft the outline`. Each state has its own symbol in Reading view and
Live Preview, using your theme's colours. Uppercase `[X]` also means done.

Right-click a checkbox, or hold it on a phone, to choose its state. In the editor,
**Cycle checkbox state** moves the current line through the table above and then back to Open. Assign
it a hotkey in Obsidian's settings if you use it often. Undo works as usual. A normal click or
tap still uses Obsidian's normal checked/unchecked toggle, not the full cycle.

Only Done is completed. Cancelled is no longer open; In progress and the other states are
still open. Scheduled and Forwarded are labels, not reminders or automatic rescheduling.
These lists do not become entries in Abele's Todo sidebar, timeline or task-note footer lists.
A task note's own checkbox still follows its `completed` property, and an embedded task-note
link keeps its existing behaviour.

## Creating a task

Run **Create new task**. A new note appears in the tasks folder (`Tasks` unless changed in
**Settings → Abele → Tasks**). The first line of its text is the task's title, and the note is
renamed after it. The title can hold links, such as `Call [[Anna]] about [[Garden]]`, and the task
then shows up under each of those notes.

**Create new task and insert into current note** does the same and leaves a link to the task at
the cursor. A link to a task in a note is drawn as the task itself, with its checkbox.

A task can also be created from the timeline sidebar, and a right-click on a day in the calendar
creates one planned for that day or due on it.

## Dates and times

A task can have a scheduled day and a deadline, each with an optional time:

| Property | Meaning |
|---|---|
| `date`, `dateTime` | The day it is planned for, and the time |
| `due`, `dueTime` | The deadline, and its time |
| `created` | When it was made |
| `completed` | When it was done. Its presence is what makes a task done |
| `recurrence` | How it repeats |

The task editor offers quick choices for dates, times and repeats. You can change those choices
in **Settings → Abele → Tasks**.

## Repeating tasks

A task with a `recurrence` creates its next copy when you tick it off, with the date moved on by
the rule: daily, weekly, monthly, yearly or a rule of your own.

The note header and the card checkbox work the same way. Normally each existing scheduled day
and deadline advances from its own date. Add `from completion` to calculate the next dates from
when you tick the task off instead. The new copy has unchecked subtasks; undoing the original's
completion does not create another copy.

Counted rules respect the interval: `every 2 weeks on Monday` skips the intervening week,
and `every 2 months on 15` skips the intervening month after the current month's 15th.

## Priority and labels

`priority` is `low`, `medium` or `high`. It puts a task higher in the list of tasks without a
date. Dated tasks stay in date order.

`labels` holds any words you like, such as `labels: [work, errands]`. Every task list can be
filtered by label. Give a label a colour in **Settings → Abele → Tasks**. A label without a colour
is grey. The property can be renamed there too.

## Where tasks appear

- **Todo sidebar**: every open task without a date.
- **Timeline sidebar**: the calendar and dated tasks by day. A day with more tasks than the busy
  day threshold is marked.
- **Under a note**: the tasks linked to it. See [The footer](groups#the-footer).
- **In your daily note**: the tasks for that day.

Events from other calendars can show among them, read only. See
[Other calendars](logs-and-journals#other-calendars).

## A calendar in a base

**Calendar** is a view type for Obsidian Bases. Add a view to a base and pick **Calendar**: the
notes the base finds appear on a month, a week or a year, switched at the top of the view.

- **Month** lists what is on each day. A full day ends in "+N more". Press a day to see it whole
  under the month, with **Week** to open its week and **New note** to add one to it. The **+**
  beside a day's number makes a note on that day too.
- **Week** puts notes with a time on the hours and the rest in a row at the top. Press an empty
  hour to make a note at that time.
- **Year** tints each day by how much is on it. Press a month's name to open it, or a day to see
  it under the year.
- **Life** shows your life in weeks: a row for each year of your age, 52 weeks to a row. Weeks
  behind you are filled in, the ones ahead are empty, and this week is outlined. A week with notes
  in it is tinted by how many there are, and shows the number when there is room. Above the grid:
  how many weeks you have lived, how many are left, and how far along you are. Press a week to
  list its notes under the grid, with **Week** to open it by the hour; the arrows move a week at
  a time and **Today** comes back to this one.

Within a day, notes follow the base's own sort when it has one; without a sort, longer notes
come first, then by time. Done tasks go to the end of each day either way. Turn off **Done tasks
last** in the view's options to leave them where the sort puts them.

Drag a note to another day to move it there; drag it onto an hour of the week to give it that
time. A note with an end date keeps its length, and one with an end time keeps its duration.
On a phone or tablet, hold the note for a moment before dragging it, so a swipe still scrolls.

A note opens when you press it, in a new tab with Cmd or Ctrl. Hover over one to preview it. A new
note made from the calendar goes where the base's own **New** button would put it, with the date
already filled in.

By default the calendar reads the task properties, `date`, `dateTime`, `due` and `dueTime`, so a
base over your tasks needs no setup. For other notes, choose the properties in the view's
options. If the base groups its notes, each group gets a colour. **Show calendar events** adds
the events from [Other calendars](logs-and-journals#other-calendars).

The life in weeks counts from your birth date and runs to your life expectancy, 80 years unless
you change it. Both are in **Settings → Abele → Tasks** and shared by every base; the first time
you open **Life** without a birth date, it asks for one right there. **Life expectancy** in a
view's options gives that one view its own number of years.

On a narrow screen, the month shows dots. Tap a day to list what is on it under the calendar,
and drag a note from that list onto another day to move it.

## Moving from Dataview

**Migrate tasks from Dataview** turns Dataview checklist tasks into task notes.
**Migrate from Dataview fields** moves inline `key:: value` fields into frontmatter.
