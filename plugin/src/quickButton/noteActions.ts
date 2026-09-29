/**
 * What the quick menu offers for a note: its timer, where the header would show one, and a
 * agent/chat actions where AI is on, and copying a link either way. The actions are the
 * plugin's own commands, asked first whether they apply — the same question their menus ask.
 */
import { unref } from 'vue'
import type { App, Menu, TFile } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { getFrontmatterFromCache } from '@/helpers/notesUtils'
import { timerActiveFor, toggleTimerFor } from '@/composables/useTimerButton'
import type { TimeEntry } from '@/entities/TimeEntry'
import type { TimeEntryList } from '@/entities/TimeEntryList'
import { commandAvailable } from './menu'
import { NOTE_ACTIONS } from '@/commands/noteActions'

const COMMANDS = NOTE_ACTIONS.map((action) => ({ ...action, id: `abele:${action.id}` }))

export function noteQuickActions(app: App, menu: Menu, file: TFile): void {
  const frontmatter = getFrontmatterFromCache(file.path)
  const type = typeof frontmatter?.type === 'string' ? frontmatter.type : null
  if (type !== 'time-entry' && AbeleConfig.getInstance().isTimeTrackable(type)) {
    const list = unref(GlobalStore.getInstance().timeEntryList) as TimeEntryList | null
    const entries = (list?.activeEntries ?? []) as unknown as TimeEntry[]
    const active = timerActiveFor(file.path, entries)
    menu.addItem((item) =>
      item
        .setTitle(active ? 'Stop timer' : 'Start timer')
        .setIcon(active ? 'timer-off' : 'timer')
        .onClick(() => toggleTimerFor(file.path, active))
    )
  }

  const commands = (app as unknown as { commands: { executeCommandById(id: string): boolean } })
    .commands
  for (const command of COMMANDS) {
    if (!commandAvailable(app, command.id)) continue
    menu.addItem((item) =>
      item
        .setTitle(command.title)
        .setIcon(command.icon)
        .onClick(() => void commands.executeCommandById(command.id))
    )
  }
}
