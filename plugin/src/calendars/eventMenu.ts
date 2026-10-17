import { t } from '@/i18n'
import { openExternal } from '@/helpers/openExternal'
import { Menu, Notice } from 'obsidian'
import type { CalendarEvent } from './events'
import { createMeetingNote } from './meetingNote'
import { calendars } from './CalendarService'

/** The same local action for a checkbox and a menu, with a visible save failure. */
export async function toggleEventDone(event: CalendarEvent): Promise<void> {
  try {
    await calendars().setDone(event, !calendars().isDone(event))
  } catch (e) {
    new Notice(t('area.eventSaveError', { error: (e as Error).message }))
  }
}

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
      .setTitle(calendars().isDone(event) ? t('area.markUndone') : t('area.markDone'))
      .setIcon(calendars().isDone(event) ? 'square' : 'check-square')
      .onClick(() => void toggleEventDone(event))
  )
  menu.addItem((item) =>
    item
      .setTitle(t('area.createMeetingNote'))
      .setIcon('file-plus')
      .onClick(() => {
        createMeetingNote(event, day).catch((err) => {
          new Notice(t('area.meetingCreateError', { error: (err as Error).message }))
        })
      })
  )
  if (event.url) {
    menu.addItem((item) =>
      item
        .setTitle(t('area.openTheEventLink'))
        .setIcon('external-link')
        .onClick(() => openExternal(event.url, '_blank'))
    )
  }
  if (e instanceof MouseEvent) menu.showAtMouseEvent(e)
  else {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    menu.showAtPosition({ x: box.left, y: box.bottom })
  }
}
