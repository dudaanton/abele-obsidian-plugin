# Tasks

Tasks are notes: one note per task, with its dates in properties and its description in the body.

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

- **Month** lists what is on each day. A full day ends in "+N more". Press a day's number for
  its week, or the **+** beside it for a new note on that day.
- **Week** puts notes with a time on the hours and the rest in a row at the top. Press an empty
  hour to make a note at that time.
- **Year** tints each day by how much is on it. Press a month's name or a day to go there.

A note opens when you press it, in a new tab with Cmd or Ctrl. Hover over one to preview it. A new
note made from the calendar goes where the base's own **New** button would put it, with the date
already filled in.

By default the calendar reads the task properties, `date`, `dateTime`, `due` and `dueTime`, so a
base over your tasks needs no setup. For other notes, choose the properties in the view's
options. If the base groups its notes, each group gets a colour. **Show calendar events** adds
the events from [Other calendars](logs-and-journals#other-calendars).

On a narrow screen, the month shows dots. Tap a day to list what is on it under the calendar.

## Moving from Dataview

**Migrate tasks from Dataview** turns Dataview checklist tasks into task notes.
**Migrate from Dataview fields** moves inline `key:: value` fields into frontmatter.
