import {
  Editor,
  MarkdownPostProcessorContext,
  MarkdownView,
  Plugin,
  TFile,
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
import {
  createNoteFromTemplate,
  replaceNoteWithTemplate,
  insertTemplateAtCursor,
} from './commands/templateCommands'
import { TemplateService } from './templates/TemplateService'
import { taskStateField } from './editor/TaskPlugin'
import { findAndReplace } from './commands/findAndReplace'
import { TIMELINE_SIDEBAR_VIEW_TYPE, TimelineSidebarView } from './views/TimelineSidebarView'
import { TODO_SIDEBAR_VIEW_TYPE, TodoSidebarView } from './views/TodoSidebarView'
import weekday from 'dayjs/plugin/weekday'
import updateLocale from 'dayjs/plugin/updateLocale'
import dayOfYear from 'dayjs/plugin/dayOfYear'
import dayjs from 'dayjs'
import { AbeleSettingTab } from './settings'
import { createHeaderExtension } from './editor/HeaderExtension'
import { migrateFromDataview } from './commands/migrateFromDataview'
import { VaultWatcherWrapper } from './helpers/VaultWatcherWrapper'
import { readFileContent } from './helpers/vaultUtils'

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

    dayjs.updateLocale('en', {
      weekStart: AbeleConfig.getInstance().weekStartsOnMonday ? 1 : 0,
    })

    GlobalStore.getInstance().init(this.app)

    this.addSettingTab(new AbeleSettingTab(this.app, this))

    console.debug('Abele Plugin loaded.')

    this.registerView(TIMELINE_SIDEBAR_VIEW_TYPE, (leaf) => new TimelineSidebarView(leaf, this.app))
    this.registerView(TODO_SIDEBAR_VIEW_TYPE, (leaf) => new TodoSidebarView(leaf, this.app))

    this.initializeVue()

    this.registerEditorExtension(taskStateField)
    this.registerEditorExtension(createHeaderExtension())

    // this.registerPriorityCodeblockPostProcessor(
    //   TASK_CODEBLOCK_KEYWORD,
    //   -100,
    //   async (source: string, el, ctx) => TaskRenderer.register(source, el, ctx)
    // )

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        const viewType = leaf?.view.getViewType()
        if (viewType === 'empty') {
          GlobalStore.getInstance().currentFile.value = null
          return
        }
        if (leaf?.view.getViewType() !== 'markdown') return

        const file = (leaf.view as MarkdownView).file

        if (file) {
          GlobalStore.getInstance().currentFile.value = file
        }
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
      id: 'migrate-from-dataview',
      name: 'Migrate tasks from Dataview to Abele',
      callback: () => {
        migrateFromDataview()
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
      id: 'show-todo-sidebar',
      name: 'Show TODO sidebar',
      callback: () => {
        this.activateView(TODO_SIDEBAR_VIEW_TYPE)
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

    this.addRibbonIcon(TimelineSidebarView.getIcon(), 'Show timeline sidebar', () => {
      this.activateView(TIMELINE_SIDEBAR_VIEW_TYPE)
    })

    this.addRibbonIcon(TodoSidebarView.getIcon(), 'Show todo sidebar', () => {
      this.activateView(TODO_SIDEBAR_VIEW_TYPE)
    })

    // Register default template hook only after workspace is ready
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on('create', async (file) => {
          if (!(file instanceof TFile)) return
          if (file.extension !== 'md') return

          // Check if path is excluded
          if (AbeleConfig.getInstance().isPathExcludedFromDefaultTemplate(file.path)) return

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

  onunload() {
    GlobalStore.getInstance().destroy()
    AbeleConfig.getInstance().destroy()
    VaultWatcherWrapper.destroy()
    // this.cleanupWidgets()
    if (this.vueApp) {
      this.vueApp.unmount()
      document.getElementById('abele-vue-root')?.remove()
    }
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
