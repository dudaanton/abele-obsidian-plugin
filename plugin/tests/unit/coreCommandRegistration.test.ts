import { withPluginLifecycle } from '../helpers/pluginHost'
import { copyMapLocation } from '@/maps/copyLocation'
import { describe, expect, it, vi } from 'vitest'
import { registerCoreCommands } from '@/startup/registerCoreCommands'
import type { Command } from 'obsidian'
import { TimelineSidebarView, TIMELINE_SIDEBAR_VIEW_TYPE } from '@/views/TimelineSidebarView'
import { TodoSidebarView } from '@/views/TodoSidebarView'
import { FinanceSidebarView } from '@/views/FinanceSidebarView'
import { TimeTrackingSidebarView } from '@/views/TimeTrackingSidebarView'
import { ScriptRunsView } from '@/views/ScriptRunsView'

vi.mock('@/maps/copyLocation', () => ({ copyMapLocation: vi.fn().mockResolvedValue(undefined) }))

describe('core command registration', () => {
  it('retains palette order and sidebar ribbon actions', async () => {
    const commands: Command[] = []
    const ribbons: Array<{ icon: string; title: string; run: () => void }> = []
    const host = withPluginLifecycle({
      addCommand: (command: Command) => {
        commands.push(command)
      },
      addRibbonIcon: (icon: string, title: string, run: () => void) => {
        ribbons.push({ icon, title, run })
      },
      activateView: vi.fn().mockResolvedValue(undefined),
    })
    registerCoreCommands(host as never)
    expect(commands.map((command) => command.id)).toEqual([
      'copy-current-map-location',
      'review-key-destinations',
      'create-task',
      'create-task-and-insert-link',
      'find-and-replace',
      'import-files',
      'save-media',
      'unused-media',
      'deduplicate-media',
      'migrate-from-dataview',
      'migrate-from-firefly',
      'create-transaction',
      'create-transaction-and-insert-link',
      'show-timeline-sidebar',
      'migrate-dataview-fields',
      'show-todo-sidebar',
      'show-finance-sidebar',
      'show-accounts-sidebar',
      'migrate-from-toggl',
      'show-time-tracking-sidebar',
      'start-timer',
      'stop-timer',
      'paste-from-clipboard',
      'create-note-from-template',
      'create-note-in-group',
      'replace-note-with-template',
      'insert-template-at-cursor',
      'insert-gallery',
      'convert-images-to-galleries',
      'reindex-footnotes',
      'insert-highlight',
      'remove-highlight',
      'set-cover-from-first-media',
      'open-today-daily-note',
      'create-css-snippet',
      'reload-css-snippets',
      'create-script',
    ])
    expect(ribbons.map(({ icon, title }) => ({ icon, title }))).toEqual([
      { icon: TimelineSidebarView.getIcon(), title: 'Show timeline sidebar' },
      { icon: TodoSidebarView.getIcon(), title: 'Show todo sidebar' },
      { icon: FinanceSidebarView.getIcon(), title: 'Show finance sidebar' },
      { icon: TimeTrackingSidebarView.getIcon(), title: 'Show time tracking' },
      { icon: ScriptRunsView.getIcon(), title: 'Show script runs' },
    ])
    commands.find((command) => command.id === 'show-timeline-sidebar')!.callback!()
    expect(host.activateView).toHaveBeenCalledWith(TIMELINE_SIDEBAR_VIEW_TYPE)
    commands.find((command) => command.id === 'copy-current-map-location')!.callback!()
    const signal = vi.mocked(copyMapLocation).mock.calls.at(-1)![0]!
    expect(signal.aborted).toBe(false)
    host.unload()
    expect(signal.aborted).toBe(true)
    host.activateView.mockClear()
    ribbons[0].run()
    expect(host.activateView).toHaveBeenCalledWith(TIMELINE_SIDEBAR_VIEW_TYPE)
  })
})
