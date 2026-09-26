import { Menu, Notice } from 'obsidian'
import type { CalendarEvent } from './events'
import { createMeetingNote } from './meetingNote'

/**
 * What can be done with an event from an external calendar, wherever it is shown — the
 * timeline, the calendar view of a base: a note about it, and its link when it has one.
 *
 * @param day the day it was pressed under, `YYYY-MM-DD`
 */
export function openEventMenu(event: CalendarEvent, day: string, e: MouseEvent | KeyboardEvent) {
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle('Create meeting note')
      .setIcon('file-plus')
      .onClick(() => {
        createMeetingNote(event, day).catch((err) => {
          new Notice(`The meeting note could not be created: ${(err as Error).message}`)
        })
      })
  )
  if (event.url) {
    menu.addItem((item) =>
      item
        .setTitle('Open the event link')
        .setIcon('external-link')
        .onClick(() => window.open(event.url, '_blank'))
    )
  }
  if (e instanceof MouseEvent) menu.showAtMouseEvent(e)
  else {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    menu.showAtPosition({ x: box.left, y: box.bottom })
  }
}
