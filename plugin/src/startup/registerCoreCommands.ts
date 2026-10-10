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
  plugin.addCommand({
    id: 'review-key-destinations',
    name: 'Review key destinations',
    callback: reviewKeyDestinations,
  })
  plugin.addCommand({
    id: 'create-task',
    name: 'Create new task',
    icon: 'circle-plus',
    callback: () => {
      void createTask()
    },
  })

  plugin.addCommand({
    id: 'create-task-and-insert-link',
    name: 'Create new task and insert into current note',
    icon: 'list-plus',
    editorCallback: (editor: Editor) => {
      void createTaskAndInsert(editor)
    },
  })

  plugin.addCommand({
    id: 'find-and-replace',
    name: 'Find and replace in frontmatter and content of all notes, matching the criteria',
    icon: 'replace-all',
    callback: () => {
      void findAndReplace()
    },
  })

  plugin.addCommand({
    id: 'import-files',
    name: 'Import files to vault',
    icon: 'import',
    callback: () => {
      importFiles()
    },
  })

  plugin.addCommand({
    id: 'save-media',
    name: 'Save remote media to vault',
    icon: 'download',
    callback: () => {
      saveMedia()
    },
  })

  plugin.addCommand({
    id: 'unused-media',
    name: 'Find and delete unused media',
    icon: 'trash-2',
    callback: () => {
      unusedMedia()
    },
  })

  plugin.addCommand({
    id: 'deduplicate-media',
    name: 'Deduplicate media attachments',
    icon: 'copy-check',
    callback: () => {
      deduplicateMedia()
    },
  })

  plugin.addCommand({
    id: 'migrate-from-dataview',
    name: 'Migrate tasks from Dataview',
    icon: 'database',
    callback: () => {
      void migrateFromDataview()
    },
  })

  plugin.addCommand({
    id: 'migrate-from-firefly',
    name: 'Migrate data from Firefly III',
    icon: 'database',
    callback: () => {
      void openUtilityDialog('migrateFromFirefly')
    },
  })

  plugin.addCommand({
    id: 'create-transaction',
    name: 'Create new transaction',
    icon: 'receipt',
    callback: () => {
      void createTransaction()
    },
  })

  plugin.addCommand({
    id: 'create-transaction-and-insert-link',
    name: 'Create new transaction and insert into current note',
    icon: 'receipt',
    editorCallback: (editor: Editor) => {
      void createTransactionAndInsert(editor)
    },
  })

  plugin.addCommand({
    id: 'show-timeline-sidebar',
    name: 'Show timeline sidebar',
    icon: 'calendar-range',
    callback: () => {
      void plugin.activateView(TIMELINE_SIDEBAR_VIEW_TYPE)
    },
  })

  plugin.addCommand({
    id: 'migrate-dataview-fields',
    name: 'Migrate from Dataview fields',
    icon: 'database',
    callback: () => {
      void openUtilityDialog('migrateDataviewFields')
    },
  })

  plugin.addCommand({
    id: 'show-todo-sidebar',
    name: 'Show todo sidebar',
    icon: 'check-square',
    callback: () => {
      void plugin.activateView(TODO_SIDEBAR_VIEW_TYPE)
    },
  })

  plugin.addCommand({
    id: 'show-finance-sidebar',
    name: 'Show finance sidebar',
    icon: 'wallet',
    callback: () => {
      void plugin.activateView(FINANCE_SIDEBAR_VIEW_TYPE)
    },
  })

  plugin.addCommand({
    id: 'show-accounts-sidebar',
    name: 'Show accounts sidebar',
    icon: AccountsSidebarView.getIcon(),
    callback: () => {
      void plugin.activateView(ACCOUNTS_SIDEBAR_VIEW_TYPE)
    },
  })

  plugin.addCommand({
    id: 'migrate-from-toggl',
    name: 'Migrate time entries from Toggl',
    icon: 'database',
    callback: () => {
      void openUtilityDialog('migrateFromToggl')
    },
  })

  plugin.addCommand({
    id: 'show-time-tracking-sidebar',
    name: 'Show time tracking sidebar',
    icon: 'timer',
    callback: () => {
      void plugin.activateView(TIME_TRACKING_SIDEBAR_VIEW_TYPE)
    },
  })

  plugin.addCommand({
    id: 'start-timer',
    name: 'Start timer for current note',
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
    name: 'Stop active timer',
    icon: 'square',
    callback: () => {
      void stopActiveTimeEntry()
    },
  })

  plugin.addCommand({
    id: 'paste-from-clipboard',
    name: 'Paste from clipboard at cursor',
    icon: 'clipboard-paste',
    editorCallback: async (editor: Editor) => {
      await pasteFromClipboard(editor)
    },
  })

  plugin.addCommand({
    id: 'create-note-from-template',
    name: 'Create note from template',
    icon: 'file-plus-2',
    callback: () => {
      createNoteFromTemplate()
    },
  })

  plugin.addCommand({
    id: 'create-note-in-group',
    name: 'Create note in group',
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
    name: 'Replace current note with template',
    icon: 'file-input',
    callback: () => {
      replaceNoteWithTemplate()
    },
  })

  plugin.addCommand({
    id: 'insert-template-at-cursor',
    name: 'Insert template at cursor',
    icon: 'file-symlink',
    editorCallback: (editor: Editor) => {
      insertTemplateAtCursor(editor)
    },
  })

  plugin.addCommand({
    id: 'insert-gallery',
    name: 'Insert image gallery',
    icon: 'gallery-horizontal',
    editorCallback: (editor: Editor) => {
      insertGallery(editor)
    },
  })

  plugin.addCommand({
    id: 'convert-images-to-galleries',
    name: 'Convert images on page to galleries',
    icon: 'images',
    editorCallback: (editor: Editor) => {
      convertImagesToGalleries(editor)
    },
  })

  plugin.addCommand({
    id: 'reindex-footnotes',
    name: 'Reindex footnotes',
    icon: 'list-ordered',
    editorCallback: (editor: Editor) => {
      reindexFootnotes(editor)
    },
  })

  plugin.addCommand({
    id: 'insert-highlight',
    name: 'Insert colored highlight',
    icon: 'highlighter',
    editorCallback: (editor: Editor) => {
      void insertHighlight(editor)
    },
  })

  plugin.addCommand({
    id: 'remove-highlight',
    name: 'Remove colored highlight',
    icon: 'eraser',
    editorCallback: (editor: Editor) => {
      removeHighlight(editor)
    },
  })

  plugin.addCommand({
    id: 'set-cover-from-first-media',
    name: 'Set cover from first image/video in note',
    icon: 'image',
    callback: () => {
      void setCoverFromFirstMedia()
    },
  })

  plugin.addCommand({
    id: 'open-today-daily-note',
    name: "Open today's daily note",
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
    name: 'Create CSS snippet',
    icon: 'palette',
    callback: () => {
      void SnippetService.getInstance().createSnippet()
    },
  })

  plugin.addCommand({
    id: 'reload-css-snippets',
    name: 'Reload CSS snippets',
    icon: 'refresh-cw',
    callback: async () => {
      await SnippetService.getInstance().reload()
      new Notice('CSS snippets reloaded')
    },
  })

  plugin.addCommand({
    id: 'create-script',
    name: 'Create script',
    icon: 'scroll-text',
    callback: () => {
      void ScriptService.getInstance().createScript()
    },
  })

  plugin.addRibbonIcon(TimelineSidebarView.getIcon(), 'Show timeline sidebar', () => {
    void plugin.activateView(TIMELINE_SIDEBAR_VIEW_TYPE)
  })

  plugin.addRibbonIcon(TodoSidebarView.getIcon(), 'Show todo sidebar', () => {
    void plugin.activateView(TODO_SIDEBAR_VIEW_TYPE)
  })

  plugin.addRibbonIcon(FinanceSidebarView.getIcon(), 'Show finance sidebar', () => {
    void plugin.activateView(FINANCE_SIDEBAR_VIEW_TYPE)
  })

  plugin.addRibbonIcon(TimeTrackingSidebarView.getIcon(), 'Show time tracking', () => {
    void plugin.activateView(TIME_TRACKING_SIDEBAR_VIEW_TYPE)
  })

  plugin.addRibbonIcon(ScriptRunsView.getIcon(), 'Show script runs', () => {
    void plugin.activateView(SCRIPT_RUNS_VIEW_TYPE)
  })
}
