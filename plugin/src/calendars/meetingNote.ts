/**
 * "Create meeting note" on an event: a note of one's own about it, tied to the day it happened
 * through `groups` — which is how a meeting report is written in Abele anyway — and to the
 * people in it where the vault already has a note for them.
 *
 * Nothing is created until asked for, and asking again opens the note made the first time.
 */
import { TFile, normalizePath } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { renderTemplate } from '@/helpers/notesUtils'
import { cleanFileName } from '@/helpers/pathsHelpers'
import type { CalendarEvent } from './events'

/** `09:05` on this device's clock. */
export const clockTime = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** `09:00–10:00`, or `All day`. */
export function eventTimeText(event: CalendarEvent): string {
  if (event.allDay) return 'All day'
  return event.end > event.start
    ? `${clockTime(event.start)}–${clockTime(event.end)}`
    : clockTime(event.start)
}

/**
 * The note's text. `link` turns a name into a wikilink when the vault has a note by it, and
 * returns `null` when it has not.
 */
export function meetingNoteContent(
  event: CalendarEvent,
  dayLink: string,
  link: (name: string) => string | null
): string {
  const details = [eventTimeText(event), event.location].filter(Boolean).join(' · ')
  const people = event.attendees.map((name) => link(name) ?? name)
  const lines = ['---', 'groups:', `  - "[[${dayLink}]]"`, '---', event.title, '', details]
  if (people.length) lines.push(`With ${people.join(', ')}`)
  if (event.url) lines.push(event.url)
  lines.push('')
  return lines.join('\n')
}

/** The day's daily note as a link target: the default daily journal's, or the date itself. */
function dayLinkTarget(day: string): string {
  const journal = AbeleConfig.getInstance().journals.find((j) => j.isDefaultDailyJournal)
  if (!journal?.newPathTemplate) return day
  const path = normalizePath(renderTemplate(journal.newPathTemplate, { date: day }))
  return path.replace(/\.md$/, '').split('/').pop() || day
}

export async function createMeetingNote(event: CalendarEvent, day: string): Promise<void> {
  const { app } = GlobalStore.getInstance()
  const parent = app.fileManager.getNewFileParent('')
  const name = cleanFileName(`${event.title} ${day}`)
  const path = normalizePath(
    `${parent?.path && parent.path !== '/' ? `${parent.path}/` : ''}${name}.md`
  )

  const existing = app.vault.getAbstractFileByPath(path)
  const file =
    existing instanceof TFile
      ? existing
      : await app.vault.create(
          path,
          meetingNoteContent(event, dayLinkTarget(day), (person) => {
            const note = app.metadataCache.getFirstLinkpathDest(person, '')
            return note ? `[[${person}]]` : null
          })
        )
  await app.workspace.getLeaf(false).openFile(file)
}
