import { copyMapLocation } from '@/maps/copyLocation'
import { t } from '@/i18n'
import { type Editor, Notice, type Plugin } from 'obsidian'
import dayjs from 'dayjs'
import { reviewKeyDestinations } from '@/secrets/destinationReview'
import { createTask, createTaskAndInsert } from '@/commands/createTask'
import { createTransaction, createTransactionAndInsert } from '@/commands/createTransaction'
import { createTimeEntry, stopActiveTimeEntry } from '@/commands/createTimeEntry'
import { createNoteInGroup } from '@/commands/createNoteInGroup'
import { findAndReplace } from '@/commands/findAndReplace'
import { importFiles } from '@/commands/importFiles'
import { saveMedia } from '@/commands/saveMedia'
import { unusedMedia } from '@/commands/unusedMedia'
import { deduplicateMedia } from '@/commands/deduplicateMedia'
import { migrateFromDataview } from '@/commands/migrateFromDataview'
import { openUtilityDialog } from '@/commands/utilityDialogs'
import { pasteFromClipboard } from '@/commands/pasteFromClipboard'
import {
  createNoteFromTemplate,
  replaceNoteWithTemplate,
  insertTemplateAtCursor,
} from '@/commands/templateCommands'
import { insertGallery, convertImagesToGalleries } from '@/commands/galleryCommands'
import { reindexFootnotes } from '@/commands/footnoteCommands'
import { insertHighlight, removeHighlight } from '@/commands/highlightCommands'
import { setCoverFromFirstMedia } from '@/commands/setCover'
import { TIMELINE_SIDEBAR_VIEW_TYPE, TimelineSidebarView } from '@/views/TimelineSidebarView'
import { TODO_SIDEBAR_VIEW_TYPE, TodoSidebarView } from '@/views/TodoSidebarView'
import { FINANCE_SIDEBAR_VIEW_TYPE, FinanceSidebarView } from '@/views/FinanceSidebarView'
import { ACCOUNTS_SIDEBAR_VIEW_TYPE, AccountsSidebarView } from '@/views/AccountsSidebarView'
import {
  TIME_TRACKING_SIDEBAR_VIEW_TYPE,
  TimeTrackingSidebarView,
} from '@/views/TimeTrackingSidebarView'
import { SCRIPT_RUNS_VIEW_TYPE, ScriptRunsView } from '@/views/ScriptRunsView'
import { AbeleConfig } from '@/services/AbeleConfig'
import { SnippetService } from '@/services/SnippetService'
import { ScriptService } from '@/scripting/ScriptService'

interface CoreCommandHost extends Plugin {
  activateView(viewType: string): Promise<void>
}

/** The general palette and ribbon section, independent of the AI feature switches. */
export function registerCoreCommands(plugin: CoreCommandHost) {
  const locationAbort = new AbortController()
  plugin.register(() => locationAbort.abort())
  plugin.addCommand({
    id: 'copy-current-map-location',
    name: t('commands.copy-current-map-location'),
    callback: () => {
      void copyMapLocation(locationAbort.signal)
    },
  })
  plugin.addCommand({
    id: 'review-key-destinations',
    name: t('commands.review-key-destinations'),
    callback: reviewKeyDestinations,
  })
  plugin.addCommand({
    id: 'create-task',
    name: t('commands.create-task'),
    icon: 'circle-plus',
    callback: () => {
      void createTask()
    },
  })

  plugin.addCommand({
    id: 'create-task-and-insert-link',
    name: t('commands.create-task-and-insert-link'),
    icon: 'list-plus',
    editorCallback: (editor: Editor) => {
      void createTaskAndInsert(editor)
    },
  })

  plugin.addCommand({
    id: 'find-and-replace',
    name: t('commands.find-and-replace'),
    icon: 'replace-all',
    callback: () => {
      void findAndReplace()
    },
  })

  plugin.addCommand({
    id: 'import-files',
    name: t('commands.import-files'),
    icon: 'import',
    callback: () => {
      importFiles()
    },
  })

  plugin.addCommand({
    id: 'save-media',
    name: t('commands.save-media'),
    icon: 'download',
    callback: () => {
      saveMedia()
    },
  })

  plugin.addCommand({
    id: 'unused-media',
    name: t('commands.unused-media'),
    icon: 'trash-2',
    callback: () => {
      unusedMedia()
    },
  })

  plugin.addCommand({
    id: 'deduplicate-media',
    name: t('commands.deduplicate-media'),
    icon: 'copy-check',
    callback: () => {
      deduplicateMedia()
    },
  })

  plugin.addCommand({
    id: 'migrate-from-dataview',
    name: t('commands.migrate-from-dataview'),
    icon: 'database',
    callback: () => {
      void migrateFromDataview()
    },
  })

  plugin.addCommand({
    id: 'migrate-from-firefly',
    name: t('commands.migrate-from-firefly'),
    icon: 'database',
    callback: () => {
      void openUtilityDialog('migrateFromFirefly')
    },
  })

  plugin.addCommand({
    id: 'create-transaction',
    name: t('commands.create-transaction'),
    icon: 'receipt',
    callback: () => {
      void createTransaction()
    },
  })

  plugin.addCommand({
    id: 'create-transaction-and-insert-link',
    name: t('commands.create-transaction-and-insert-link'),
    icon: 'receipt',
    editorCallback: (editor: Editor) => {
      void createTransactionAndInsert(editor)
    },
  })

  plugin.addCommand({
    id: 'show-timeline-sidebar',
    name: t('commands.show-timeline-sidebar'),
    icon: 'calendar-range',
    callback: () => {
      void plugin.activateView(TIMELINE_SIDEBAR_VIEW_TYPE)
    },
  })

  plugin.addCommand({
    id: 'migrate-dataview-fields',
    name: t('commands.migrate-dataview-fields'),
    icon: 'database',
    callback: () => {
      void openUtilityDialog('migrateDataviewFields')
    },
  })

  plugin.addCommand({
    id: 'show-todo-sidebar',
    name: t('commands.show-todo-sidebar'),
    icon: 'check-square',
    callback: () => {
      void plugin.activateView(TODO_SIDEBAR_VIEW_TYPE)
    },
  })

  plugin.addCommand({
    id: 'show-finance-sidebar',
    name: t('commands.show-finance-sidebar'),
    icon: 'wallet',
    callback: () => {
      void plugin.activateView(FINANCE_SIDEBAR_VIEW_TYPE)
    },
  })

  plugin.addCommand({
    id: 'show-accounts-sidebar',
    name: t('commands.show-accounts-sidebar'),
    icon: AccountsSidebarView.getIcon(),
    callback: () => {
      void plugin.activateView(ACCOUNTS_SIDEBAR_VIEW_TYPE)
    },
  })

  plugin.addCommand({
    id: 'migrate-from-toggl',
    name: t('commands.migrate-from-toggl'),
    icon: 'database',
    callback: () => {
      void openUtilityDialog('migrateFromToggl')
    },
  })

  plugin.addCommand({
    id: 'show-time-tracking-sidebar',
    name: t('commands.show-time-tracking-sidebar'),
    icon: 'timer',
    callback: () => {
      void plugin.activateView(TIME_TRACKING_SIDEBAR_VIEW_TYPE)
    },
  })

  plugin.addCommand({
    id: 'start-timer',
    name: t('commands.start-timer'),
    icon: 'play',
    callback: () => {
      const file = plugin.app.workspace.getActiveFile()
      if (file) {
        void createTimeEntry({ groups: [`[[${file.basename}]]`] })
      }
    },
  })

  plugin.addCommand({
    id: 'stop-timer',
    name: t('commands.stop-timer'),
    icon: 'square',
    callback: () => {
      void stopActiveTimeEntry()
    },
  })

  plugin.addCommand({
    id: 'paste-from-clipboard',
    name: t('commands.paste-from-clipboard'),
    icon: 'clipboard-paste',
    editorCallback: async (editor: Editor) => {
      await pasteFromClipboard(editor)
    },
  })

  plugin.addCommand({
    id: 'create-note-from-template',
    name: t('commands.create-note-from-template'),
    icon: 'file-plus-2',
    callback: () => {
      createNoteFromTemplate()
    },
  })

  plugin.addCommand({
    id: 'create-note-in-group',
    name: t('commands.create-note-in-group'),
    icon: 'folder-plus',
    callback: () => {
      const file = plugin.app.workspace.getActiveFile()
      if (file) {
        void createNoteInGroup(file)
      }
    },
  })

  plugin.addCommand({
    id: 'replace-note-with-template',
    name: t('commands.replace-note-with-template'),
    icon: 'file-input',
    callback: () => {
      replaceNoteWithTemplate()
    },
  })

  plugin.addCommand({
    id: 'insert-template-at-cursor',
    name: t('commands.insert-template-at-cursor'),
    icon: 'file-symlink',
    editorCallback: (editor: Editor) => {
      insertTemplateAtCursor(editor)
    },
  })

  plugin.addCommand({
    id: 'insert-gallery',
    name: t('commands.insert-gallery'),
    icon: 'gallery-horizontal',
    editorCallback: (editor: Editor) => {
      insertGallery(editor)
    },
  })

  plugin.addCommand({
    id: 'convert-images-to-galleries',
    name: t('commands.convert-images-to-galleries'),
    icon: 'images',
    editorCallback: (editor: Editor) => {
      convertImagesToGalleries(editor)
    },
  })

  plugin.addCommand({
    id: 'reindex-footnotes',
    name: t('commands.reindex-footnotes'),
    icon: 'list-ordered',
    editorCallback: (editor: Editor) => {
      reindexFootnotes(editor)
    },
  })

  plugin.addCommand({
    id: 'insert-highlight',
    name: t('commands.insert-highlight'),
    icon: 'highlighter',
    editorCallback: (editor: Editor) => {
      void insertHighlight(editor)
    },
  })

  plugin.addCommand({
    id: 'remove-highlight',
    name: t('commands.remove-highlight'),
    icon: 'eraser',
    editorCallback: (editor: Editor) => {
      removeHighlight(editor)
    },
  })

  plugin.addCommand({
    id: 'set-cover-from-first-media',
    name: t('commands.set-cover-from-first-media'),
    icon: 'image',
    callback: () => {
      void setCoverFromFirstMedia()
    },
  })

  plugin.addCommand({
    id: 'open-today-daily-note',
    name: t('commands.open-today-daily-note'),
    icon: 'calendar',
    callback: () => {
      const journal = AbeleConfig.getInstance().journals.find((j) => j.isDefaultDailyJournal)
      if (!journal) {
        new Notice('No default daily journal configured')
        return
      }
      journal.createJournalNote(dayjs())
    },
  })

  plugin.addCommand({
    id: 'create-css-snippet',
    name: t('commands.create-css-snippet'),
    icon: 'palette',
    callback: () => {
      void SnippetService.getInstance().createSnippet()
    },
  })

  plugin.addCommand({
    id: 'reload-css-snippets',
    name: t('commands.reload-css-snippets'),
    icon: 'refresh-cw',
    callback: async () => {
      await SnippetService.getInstance().reload()
      new Notice('CSS snippets reloaded')
    },
  })

  plugin.addCommand({
    id: 'create-script',
    name: t('commands.create-script'),
    icon: 'scroll-text',
    callback: () => {
      void ScriptService.getInstance().createScript()
    },
  })

  plugin.addRibbonIcon(TimelineSidebarView.getIcon(), t('ribbon.show-timeline-sidebar'), () => {
    void plugin.activateView(TIMELINE_SIDEBAR_VIEW_TYPE)
  })

  plugin.addRibbonIcon(TodoSidebarView.getIcon(), t('ribbon.show-todo-sidebar'), () => {
    void plugin.activateView(TODO_SIDEBAR_VIEW_TYPE)
  })

  plugin.addRibbonIcon(FinanceSidebarView.getIcon(), t('ribbon.show-finance-sidebar'), () => {
    void plugin.activateView(FINANCE_SIDEBAR_VIEW_TYPE)
  })

  plugin.addRibbonIcon(TimeTrackingSidebarView.getIcon(), t('ribbon.show-time-tracking'), () => {
    void plugin.activateView(TIME_TRACKING_SIDEBAR_VIEW_TYPE)
  })

  plugin.addRibbonIcon(ScriptRunsView.getIcon(), t('ribbon.show-script-runs'), () => {
    void plugin.activateView(SCRIPT_RUNS_VIEW_TYPE)
  })
}
