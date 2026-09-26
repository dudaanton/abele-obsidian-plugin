/**
 * What the quick menu offers for a note: its timer, where the header would show one, and a
 * chat about it or attached to it, where the AI side is on. The last two are the plugin's own
 * commands, asked first whether they apply — the same question their menus ask.
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

const COMMANDS: { id: string; title: string; icon: string }[] = [
  {
    id: 'abele:chat-about-current-note',
    title: 'Chat about this note',
    icon: 'message-square-plus',
  },
  { id: 'abele:attach-chat-to-current-note', title: 'Attach a chat', icon: 'paperclip' },
]

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
