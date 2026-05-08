import {
  Editor,
  MarkdownPostProcessorContext,
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  TFolder,
  WorkspaceLeaf,
} from 'obsidian'
import './styles.css'
import { GlobalStore } from './stores/GlobalStore'
import { pasteFromClipboard } from './commands/pasteFromClipboard'
import { createApp, App as VueApp } from 'vue'
import { createPinia } from 'pinia'
import VueEntry from './App.vue'
import { AbeleConfig } from './services/AbeleConfig'
import { createTask, createTaskAndInsert } from './commands/createTask'
import { createTransaction, createTransactionAndInsert } from './commands/createTransaction'
import { createTimeEntry, stopActiveTimeEntry } from './commands/createTimeEntry'
import { createNoteInGroup } from './commands/createNoteInGroup'
import {
  createNoteFromTemplate,
  replaceNoteWithTemplate,
  insertTemplateAtCursor,
} from './commands/templateCommands'
import { TemplateService } from './templates/TemplateService'
import { taskStateField } from './editor/TaskPlugin'
import { galleryExtensions } from './editor/GalleryPlugin'
import { footnoteExtensions } from './editor/FootnotePlugin'
import { highlightStateField } from './editor/HighlightPlugin'
import { insertGallery, convertImagesToGalleries } from './commands/galleryCommands'
import { reindexFootnotes } from './commands/footnoteCommands'
import { insertHighlight, removeHighlight } from './commands/highlightCommands'
import { setCoverFromFirstMedia } from './commands/setCover'
import { findAndReplace } from './commands/findAndReplace'
import { saveMedia } from './commands/saveMedia'
import { importFiles } from './commands/importFiles'
import { unusedMedia } from './commands/unusedMedia'
import { deduplicateMedia } from './commands/deduplicateMedia'
import { TIMELINE_SIDEBAR_VIEW_TYPE, TimelineSidebarView } from './views/TimelineSidebarView'
import { TODO_SIDEBAR_VIEW_TYPE, TodoSidebarView } from './views/TodoSidebarView'
import { AI_SIDEBAR_VIEW_TYPE, AiSidebarView } from './views/AiSidebarView'
import { FINANCE_SIDEBAR_VIEW_TYPE, FinanceSidebarView } from './views/FinanceSidebarView'
import {
  TIME_TRACKING_SIDEBAR_VIEW_TYPE,
  TimeTrackingSidebarView,
} from './views/TimeTrackingSidebarView'
import { CHART_VIEW_ID, ChartView } from './bases/ChartView'
import { FIND_AND_REPLACE_VIEW_ID, FindAndReplaceView } from './bases/FindAndReplaceView'
import { CODE_VIEW_TYPE, CodeView } from './views/CodeView'
import { AgentService } from './ai/AgentService'
import { useFilesInAgent } from './helpers/useFilesInAgent'
import { ScriptService } from './scripting/ScriptService'
import { ScopeResolver } from './ai/ScopeResolver'
import { ChatStorage } from './ai/ChatStorage'
import weekday from 'dayjs/plugin/weekday'
import updateLocale from 'dayjs/plugin/updateLocale'
import dayOfYear from 'dayjs/plugin/dayOfYear'
import dayjs from 'dayjs'
import { AbeleSettingTab } from './settings'
import { createHeaderExtension } from './editor/HeaderExtension'
import { migrateFromDataview } from './commands/migrateFromDataview'
// migrateFromFirefly is triggered via modal
import { VaultWatcherWrapper } from './helpers/VaultWatcherWrapper'
import { readFileContent } from './helpers/vaultUtils'
import { runAfterSync } from './helpers/runAfterSync'
import { handleProtocolAction } from './helpers/protocolHandler'
import { handleLinkAction } from './helpers/linkHandler'
import { registerChartCodeblock } from './editor/ChartCodeblock'
import { SnippetService } from './services/SnippetService'

interface PluginData {}

export default class AbelePlugin extends Plugin {
  private data: PluginData = {}

  private vueApp: VueApp | null = null

  initializeVue() {
    const rootContainer = document.createElement('div')
    rootContainer.id = 'abele-vue-root'
    rootContainer.style.display = 'none'
    document.body.appendChild(rootContainer)

    this.vueApp = createApp(VueEntry)
    this.vueApp.use(createPinia())

    // Catch errors from Teleport unmounting when CM6 removes widget DOM
    this.vueApp.config.errorHandler = (err, instance, info) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (
        msg.includes('removeChild') ||
        msg.includes('parentNode') ||
        msg.includes('bum') ||
        msg.includes('emitsOptions')
      ) {
        console.debug('[Abele] Suppressed Teleport cleanup error:', msg)
        return
      }
      console.error('[Abele] Vue error:', err, info)
    }

    this.vueApp.mount(rootContainer)
  }

  getVueApp(): VueApp {
    return this.vueApp
  }

  async onload() {
    dayjs.extend(weekday)
    dayjs.extend(updateLocale)
    dayjs.extend(dayOfYear)

    AbeleConfig.getInstance().init(this)

    await this.loadPluginData()
    ;(globalThis as any).process = (globalThis as any).process || {
      env: { NODE_ENV: 'production' },
    } // Ensure process is defined for Node.js compatibility

    await AbeleConfig.getInstance().loadSettings()

    // Apply body classes from settings
    if (AbeleConfig.getInstance().fullWidthSidebars) {
      document.body.classList.add('abele-full-width-sidebars')
    }

    dayjs.updateLocale('en', {
      weekStart: AbeleConfig.getInstance().weekStartsOnMonday ? 1 : 0,
    })

    GlobalStore.getInstance().init(this.app)

    // Vault files and metadata cache are not fully available during onload().
    // Deferring TasksList creation until layout is ready ensures getMarkdownFiles()
    // and getFileCache() return complete data.
    this.app.workspace.onLayoutReady(() => {
      GlobalStore.getInstance().initTasksList()
      GlobalStore.getInstance().initFinance()
      GlobalStore.getInstance().initTimeTracking()
      SnippetService.getInstance().init()
      if (AbeleConfig.getInstance().ai.enabled) {
        AgentService.getInstance().restoreTabs()
      }
    })

    this.addSettingTab(new AbeleSettingTab(this.app, this))

    console.debug('Abele Plugin loaded.')

    this.registerView(TIMELINE_SIDEBAR_VIEW_TYPE, (leaf) => new TimelineSidebarView(leaf, this.app))
    this.registerView(TODO_SIDEBAR_VIEW_TYPE, (leaf) => new TodoSidebarView(leaf, this.app))
    this.registerView(FINANCE_SIDEBAR_VIEW_TYPE, (leaf) => new FinanceSidebarView(leaf, this.app))
    this.registerView(
      TIME_TRACKING_SIDEBAR_VIEW_TYPE,
      (leaf) => new TimeTrackingSidebarView(leaf, this.app)
    )

    this.registerView(CODE_VIEW_TYPE, (leaf) => new CodeView(leaf))
    this.registerExtensions(
      ['json', 'css', 'js', 'ts', 'html', 'xml', 'yaml', 'yml', 'csv', 'txt', 'abchat'],
      CODE_VIEW_TYPE
    )

    // AI sidebar is always registered so the view can be restored, but commands/ribbon are conditional
    this.registerView(AI_SIDEBAR_VIEW_TYPE, (leaf) => new AiSidebarView(leaf, this.app))

    // Custom Bases view types for finance
    this.registerBasesView(CHART_VIEW_ID, {
      name: 'Chart',
      icon: 'chart-line',
      factory: (controller, containerEl) => new ChartView(controller, containerEl),
      options: () => [
        {
          key: 'chartType',
          type: 'dropdown' as const,
          displayName: 'Chart type',
          default: 'line',
          options: {
            line: 'Line',
            bar: 'Bar',
            scatter: 'Scatter',
          },
        },
        {
          key: 'dateProperty',
          type: 'property' as const,
          displayName: 'Date property (X axis)',
          placeholder: 'Leave empty to use file name',
        },
        {
          key: 'groupProperty',
          type: 'property' as const,
          displayName: 'Group by property',
          placeholder: 'Optional — split into separate series',
        },
        {
          key: 'showDots',
          type: 'toggle' as const,
          displayName: 'Show data points on lines',
          default: false,
        },
        {
          key: 'logScale',
          type: 'toggle' as const,
          displayName: 'Logarithmic scale',
          default: false,
        },
        {
          key: 'dualAxis',
          type: 'toggle' as const,
          displayName: 'Separate Y axis per series',
          default: false,
        },
        {
          key: 'timeAxis',
          type: 'toggle' as const,
          displayName: 'Proportional time axis',
          default: false,
        },
        {
          key: 'chartHeight',
          type: 'slider' as const,
          displayName: 'Chart height',
          default: 500,
          min: 200,
          max: 1000,
          step: 50,
        },
      ],
    })

    this.registerBasesView(FIND_AND_REPLACE_VIEW_ID, {
      name: 'Find and replace',
      icon: 'replace-all',
      factory: (controller, containerEl) => new FindAndReplaceView(controller, containerEl),
    })

    this.initializeVue()

    this.registerEditorExtension(taskStateField)
    this.registerEditorExtension(galleryExtensions)
    this.registerEditorExtension(createHeaderExtension())
    this.registerEditorExtension(footnoteExtensions)
    this.registerEditorExtension(highlightStateField)

    // this.registerPriorityCodeblockPostProcessor(
    //   TASK_CODEBLOCK_KEYWORD,
    //   -100,
    //   async (source: string, el, ctx) => TaskRenderer.register(source, el, ctx)
    // )

    registerChartCodeblock((lang, handler) =>
      this.registerMarkdownCodeBlockProcessor(lang, handler)
    )

    this.registerEvent(
      this.app.workspace.on('css-change', () => {
        GlobalStore.getInstance().themeVersion.value++
      })
    )

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        const store = GlobalStore.getInstance()

        const viewType = leaf?.view.getViewType()
        if (viewType === 'empty') {
          store.currentFile.value = null
          return
        }

        // Intercept .abchat files: open in AI sidebar instead of editor
        if (leaf && viewType === CODE_VIEW_TYPE) {
          const file = (leaf.view as any).file as TFile | undefined
          if (file?.extension === 'abchat') {
            leaf.detach()
            const agentService = AgentService.getInstance()
            agentService.openChatFile(file).then(() => {
              const { workspace } = this.app
              let aiLeaf = workspace.getLeavesOfType(AI_SIDEBAR_VIEW_TYPE)[0] ?? null
              if (!aiLeaf) {
                aiLeaf = workspace.getRightLeaf(false)
                aiLeaf.setViewState({ type: AI_SIDEBAR_VIEW_TYPE, active: true })
              }
              workspace.revealLeaf(aiLeaf)
            })
            return
          }
        }

        if (leaf?.view.getViewType() !== 'markdown') return

        const file = (leaf.view as MarkdownView).file

        if (file) {
          store.currentFile.value = file
        }

        // Delayed cleanup for widgets whose DOM was removed without CodeMirror calling destroy().
        // The delay ensures CodeMirror's own destroy() runs first when it does fire.
        setTimeout(() => {
          store.cleanupOrphanedWidgets()
        }, 500)
      })
    )

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        // "Use in AI Agent" for folders
        if (file instanceof TFolder && AbeleConfig.getInstance().ai.enabled) {
          menu.addItem((item) => {
            item
              .setTitle('Use in AI Agent')
              .setIcon('bot')
              .onClick(async () => {
                const agentService = AgentService.getInstance()
                const session = agentService.activeSession.value
                if (!session) return
                session.scopeResolver.addFolder(file.path)
                session.scopeResolver.invalidate()
                const { workspace } = this.app
                let leaf = workspace.getLeavesOfType(AI_SIDEBAR_VIEW_TYPE)[0] ?? null
                if (!leaf) {
                  leaf = workspace.getRightLeaf(false)
                  await leaf.setViewState({ type: AI_SIDEBAR_VIEW_TYPE, active: true })
                }
                workspace.revealLeaf(leaf)
              })
          })
          return
        }

        if (!(file instanceof TFile)) return

        // "Preview" for images
        const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']
        if (IMAGE_EXTENSIONS.includes(file.extension.toLowerCase())) {
          menu.addItem((item) => {
            item
              .setTitle('Preview')
              .setIcon('eye')
              .onClick(() => {
                GlobalStore.getInstance().previewImagePath.value = file.path
              })
          })
        }

        // "Use in AI Agent" for all files
        if (AbeleConfig.getInstance().ai.enabled) {
          menu.addItem((item) => {
            item
              .setTitle('Use in AI Agent')
              .setIcon('bot')
              .onClick(() => useFilesInAgent([file]))
          })
        }

        // "Create note in group" for markdown files
        if (file.extension === 'md') {
          menu.addItem((item) => {
            item
              .setTitle('Create note in group')
              .setIcon('file-plus')
              .onClick(() => createNoteInGroup(file))
          })
        }

        // "Open as code" for code files
        const ext = file.extension
        if (
          ![
            'base',
            'json',
            'css',
            'js',
            'ts',
            'html',
            'xml',
            'yaml',
            'yml',
            'csv',
            'txt',
            'svg',
          ].includes(ext)
        )
          return
        menu.addItem((item) => {
          item
            .setTitle('Open as code')
            .setIcon('code')
            .onClick(async () => {
              const leaf = this.app.workspace.getLeaf('tab')
              await leaf.setViewState({
                type: CODE_VIEW_TYPE,
                state: { file: file.path },
              })
              this.app.workspace.setActiveLeaf(leaf, { focus: true })
            })
        })
      })
    )

    // "Use selection in AI Agent" on right-click in editor
    if (AbeleConfig.getInstance().ai.enabled) {
      this.registerEvent(
        this.app.workspace.on('editor-menu', (menu, editor, view) => {
          const selection = editor.getSelection()
          if (!selection) return
          menu.addItem((item) => {
            item
              .setTitle('Use in AI Agent')
              .setIcon('bot')
              .onClick(async () => {
                const file = view.file
                const ref = file
                  ? `> From [[${file.basename}]]:\n> ${selection.replace(/\n/g, '\n> ')}\n\n`
                  : `> ${selection.replace(/\n/g, '\n> ')}\n\n`
                const agentService = AgentService.getInstance()
                agentService.pendingInput.value = ref

                // Add file to scope
                if (file) {
                  const session = agentService.activeSession.value
                  if (session) {
                    const scope = session.scopeResolver
                    if (!scope.entries.value.some((e) => e.path === file.path)) {
                      scope.entries.value = [
                        ...scope.entries.value,
                        { type: 'file' as const, path: file.path },
                      ]
                      scope.invalidate()
                    }
                  }
                }

                const { workspace } = this.app
                let leaf = workspace.getLeavesOfType(AI_SIDEBAR_VIEW_TYPE)[0] ?? null
                if (!leaf) {
                  leaf = workspace.getRightLeaf(false)
                  await leaf.setViewState({ type: AI_SIDEBAR_VIEW_TYPE, active: true })
                }
                workspace.revealLeaf(leaf)
              })
          })
        })
      )
    }

    // "Find and create aliases" on right-click in editor
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        const selection = editor.getSelection()
        if (!selection) return

        const wikilinkRegex = /\[\[([^\]|]+)\|([^\]]+)\]\]/g
        const links: { path: string; alias: string }[] = []
        let match: RegExpExecArray | null
        while ((match = wikilinkRegex.exec(selection)) !== null) {
          links.push({ path: match[1].trim(), alias: match[2].trim() })
        }
        if (!links.length) return

        menu.addItem((item) => {
          item
            .setTitle('Find and create aliases')
            .setIcon('link')
            .onClick(async () => {
              let created = 0
              for (const { path, alias } of links) {
                const file = this.app.metadataCache.getFirstLinkpathDest(path, '')
                if (!file) continue

                const cache = this.app.metadataCache.getFileCache(file)
                const existing: string[] = cache?.frontmatter?.aliases || []
                if (existing.some((a) => a === alias)) continue

                await this.app.fileManager.processFrontMatter(file, (fm) => {
                  if (!fm.aliases) fm.aliases = []
                  if (!Array.isArray(fm.aliases)) fm.aliases = [fm.aliases]
                  fm.aliases.push(alias)
                })
                created++
              }

              if (created > 0) {
                new Notice(`Created ${created} alias${created > 1 ? 'es' : ''}`)
              } else {
                new Notice('All aliases already exist')
              }
            })
        })
      })
    )

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView)
    if (activeView?.file) {
      GlobalStore.getInstance().currentFile.value = activeView.file
    }

    this.addCommand({
      id: 'create-task',
      name: 'Create new task',
      callback: () => {
        createTask()
      },
    })

    this.addCommand({
      id: 'create-task-and-insert-link',
      name: 'Create new task and insert into current note',
      editorCallback: (editor: Editor) => {
        createTaskAndInsert(editor)
      },
    })

    this.addCommand({
      id: 'find-and-replace',
      name: 'Find and replace in frontmatter and content of all notes, matching the criteria',
      callback: () => {
        findAndReplace()
      },
    })

    this.addCommand({
      id: 'import-files',
      name: 'Import files to vault',
      callback: () => {
        importFiles()
      },
    })

    this.addCommand({
      id: 'save-media',
      name: 'Save remote media to vault',
      callback: () => {
        saveMedia()
      },
    })

    this.addCommand({
      id: 'unused-media',
      name: 'Find and delete unused media',
      callback: () => {
        unusedMedia()
      },
    })

    this.addCommand({
      id: 'deduplicate-media',
      name: 'Deduplicate media attachments',
      callback: () => {
        deduplicateMedia()
      },
    })

    this.addCommand({
      id: 'migrate-from-dataview',
      name: 'Migrate tasks from Dataview to Abele',
      callback: () => {
        migrateFromDataview()
      },
    })

    this.addCommand({
      id: 'migrate-from-firefly',
      name: 'Migrate data from Firefly III',
      callback: () => {
        GlobalStore.getInstance().migrateFromFireflyModalOpened.value = true
      },
    })

    this.addCommand({
      id: 'create-transaction',
      name: 'Create new transaction',
      callback: () => {
        createTransaction()
      },
    })

    this.addCommand({
      id: 'create-transaction-and-insert-link',
      name: 'Create new transaction and insert into current note',
      editorCallback: (editor: Editor) => {
        createTransactionAndInsert(editor)
      },
    })

    this.addCommand({
      id: 'show-timeline-sidebar',
      name: 'Show timeline sidebar',
      callback: () => {
        this.activateView(TIMELINE_SIDEBAR_VIEW_TYPE)
      },
    })

    this.addCommand({
      id: 'migrate-dataview-fields',
      name: 'Migrate from dataview fields',
      callback: () => {
        GlobalStore.getInstance().migrateDataviewFieldsModalOpened.value = true
      },
    })

    this.addCommand({
      id: 'show-todo-sidebar',
      name: 'Show TODO sidebar',
      callback: () => {
        this.activateView(TODO_SIDEBAR_VIEW_TYPE)
      },
    })

    this.addCommand({
      id: 'show-finance-sidebar',
      name: 'Show finance sidebar',
      callback: () => {
        this.activateView(FINANCE_SIDEBAR_VIEW_TYPE)
      },
    })

    this.addCommand({
      id: 'migrate-from-toggl',
      name: 'Migrate time entries from Toggl',
      callback: () => {
        GlobalStore.getInstance().migrateFromTogglModalOpened.value = true
      },
    })

    this.addCommand({
      id: 'show-time-tracking-sidebar',
      name: 'Show time tracking sidebar',
      callback: () => {
        this.activateView(TIME_TRACKING_SIDEBAR_VIEW_TYPE)
      },
    })

    this.addCommand({
      id: 'start-timer',
      name: 'Start timer for current note',
      callback: () => {
        const file = this.app.workspace.getActiveFile()
        if (file) {
          createTimeEntry({ groups: [`[[${file.basename}]]`] })
        }
      },
    })

    this.addCommand({
      id: 'stop-timer',
      name: 'Stop active timer',
      callback: () => {
        stopActiveTimeEntry()
      },
    })

    this.addCommand({
      id: 'paste-from-clipboard',
      name: 'Paste from clipboard at cursor',
      editorCallback: async (editor: Editor) => {
        pasteFromClipboard(editor)
      },
    })

    this.addCommand({
      id: 'create-note-from-template',
      name: 'Create note from template',
      callback: () => {
        createNoteFromTemplate()
      },
    })

    this.addCommand({
      id: 'create-note-in-group',
      name: 'Create note in group',
      callback: () => {
        const file = this.app.workspace.getActiveFile()
        if (file) {
          createNoteInGroup(file)
        }
      },
    })

    this.addCommand({
      id: 'replace-note-with-template',
      name: 'Replace current note with template',
      callback: () => {
        replaceNoteWithTemplate()
      },
    })

    this.addCommand({
      id: 'insert-template-at-cursor',
      name: 'Insert template at cursor',
      editorCallback: (editor: Editor) => {
        insertTemplateAtCursor(editor)
      },
    })

    this.addCommand({
      id: 'insert-gallery',
      name: 'Insert image gallery',
      editorCallback: (editor: Editor) => {
        insertGallery(editor)
      },
    })

    this.addCommand({
      id: 'convert-images-to-galleries',
      name: 'Convert images on page to galleries',
      editorCallback: (editor: Editor) => {
        convertImagesToGalleries(editor)
      },
    })

    this.addCommand({
      id: 'reindex-footnotes',
      name: 'Reindex footnotes',
      editorCallback: (editor: Editor) => {
        reindexFootnotes(editor)
      },
    })

    this.addCommand({
      id: 'insert-highlight',
      name: 'Insert colored highlight',
      editorCallback: (editor: Editor) => {
        insertHighlight(editor)
      },
    })

    this.addCommand({
      id: 'remove-highlight',
      name: 'Remove colored highlight',
      editorCallback: (editor: Editor) => {
        removeHighlight(editor)
      },
    })

    this.addCommand({
      id: 'set-cover-from-first-media',
      name: 'Set cover from first image/video in note',
      callback: () => {
        setCoverFromFirstMedia()
      },
    })

    this.addCommand({
      id: 'open-today-daily-note',
      name: "Open today's daily note",
      callback: () => {
        const journal = AbeleConfig.getInstance().journals.find((j) => j.isDefaultDailyJournal)
        if (!journal) {
          new Notice('No default daily journal configured')
          return
        }
        journal.createJournalNote(dayjs())
      },
    })

    this.addCommand({
      id: 'create-css-snippet',
      name: 'Create CSS snippet',
      callback: () => {
        SnippetService.getInstance().createSnippet()
      },
    })

    this.addCommand({
      id: 'reload-css-snippets',
      name: 'Reload CSS snippets',
      callback: async () => {
        await SnippetService.getInstance().reload()
        new Notice('CSS snippets reloaded')
      },
    })

    this.addCommand({
      id: 'create-script',
      name: 'Create script',
      callback: () => {
        ScriptService.getInstance().createScript()
      },
    })

    this.addRibbonIcon(TimelineSidebarView.getIcon(), 'Show timeline sidebar', () => {
      this.activateView(TIMELINE_SIDEBAR_VIEW_TYPE)
    })

    this.addRibbonIcon(TodoSidebarView.getIcon(), 'Show todo sidebar', () => {
      this.activateView(TODO_SIDEBAR_VIEW_TYPE)
    })

    this.addRibbonIcon(FinanceSidebarView.getIcon(), 'Show finance sidebar', () => {
      this.activateView(FINANCE_SIDEBAR_VIEW_TYPE)
    })

    this.addRibbonIcon(TimeTrackingSidebarView.getIcon(), 'Show time tracking', () => {
      this.activateView(TIME_TRACKING_SIDEBAR_VIEW_TYPE)
    })

    // AI Agent — conditional on settings
    if (AbeleConfig.getInstance().ai.enabled) {
      this.registerAiFeatures()
    }

    // Register protocol handler for obsidian://abele
    // Routes to link handler when "name" param is present, otherwise to protocol action
    this.registerObsidianProtocolHandler('abele', (params) => {
      const exec = () => {
        if (params.name) {
          handleLinkAction(this.app, params)
        } else {
          handleProtocolAction(this.app, params)
        }
      }

      // Check if the link opts out of sync waiting
      if (params.name) {
        const link = AbeleConfig.getInstance().links.find((l) => l.name === params.name)
        if (link && !link.waitForSync) {
          exec()
          return
        }
      }

      runAfterSync(this.app, exec)
    })

    // Register default template hook only after workspace is ready
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on('create', async (file) => {
          if (!(file instanceof TFile)) return
          if (file.extension !== 'md') return

          // Check if path is excluded
          if (AbeleConfig.getInstance().isPathExcludedFromDefaultTemplate(file.path)) return

          // Journals have their own templates
          if (AbeleConfig.getInstance().journals.some((j) => j.checkIfNotePathIsJournal(file.path)))
            return

          // Wait for 1 second to ensure there is no content being added (e.g., from Obsidian Web Clipper)
          await new Promise((res) => setTimeout(res, 1000))

          // Check if file is empty
          const content = await readFileContent(file)
          if (content.trim() !== '') return

          // Apply default template
          await TemplateService.getInstance().applyDefaultTemplate(file)
        })
      )
    })
  }

  registerAiFeatures() {
    this.addCommand({
      id: 'show-ai-sidebar',
      name: 'Show AI chat sidebar',
      callback: () => {
        this.activateView(AI_SIDEBAR_VIEW_TYPE)
      },
    })

    this.addRibbonIcon(AiSidebarView.getIcon(), 'Show AI chat', () => {
      this.activateView(AI_SIDEBAR_VIEW_TYPE)
    })

    if (AbeleConfig.getInstance().ai.scriptsEnabled) {
      this.app.workspace.onLayoutReady(() => {
        ScriptService.getInstance().init()
      })
    }
  }

  onunload() {
    document.body.classList.remove('abele-full-width-sidebars')
    // Unmount Vue BEFORE store cleanup so Teleport components unmount cleanly
    if (this.vueApp) {
      this.vueApp.unmount()
      document.getElementById('abele-vue-root')?.remove()
    }
    SnippetService.destroy()
    ScriptService.destroy()
    AgentService.getInstance().destroy()
    ScopeResolver.getInstance().destroy()
    ChatStorage.destroy()
    GlobalStore.getInstance().destroy()
    AbeleConfig.getInstance().destroy()
    VaultWatcherWrapper.destroy()
    console.debug('Obsidian Service Plugin unloaded.')
  }

  // from dataview
  /** Register a markdown codeblock post processor with the given priority. */
  public registerPriorityCodeblockPostProcessor(
    language: string,
    priority: number,
    processor: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<void>
  ) {
    const registered = this.registerMarkdownCodeBlockProcessor(language, processor)
    registered.sortOrder = priority
  }

  async activateView(viewType: string) {
    const { workspace } = this.app

    let leaf: WorkspaceLeaf | null = null
    const leaves = workspace.getLeavesOfType(viewType)

    if (leaves.length > 0) {
      leaf = leaves[0]
    } else {
      leaf = workspace.getRightLeaf(false)
      await leaf.setViewState({ type: viewType, active: true })
    }

    workspace.revealLeaf(leaf)
  }

  async loadPluginData() {
    this.data = (await this.loadData()) || {}
  }

  async savePluginData() {
    await this.saveData(this.data)
  }
}
