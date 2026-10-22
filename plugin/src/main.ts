import { t, initializeLocale, currentLocale } from '@/i18n'
import { initializePluginLocale } from '@/i18n/initialize'
import { hostLocale } from '@/i18n/obsidianLocale'
import { registerZen } from '@/zen/registerZen'
import { ChangeTracker } from '@/ai/rewind/ChangeTracker'
import '@/helpers/deferredCleanup'
import { openSyncedFile } from './sync/openSyncedFile'
import { tokenOffloadsOf } from './sync/tokenOffloadCoordinator'
import { pathCoordinatorOf } from './sync/pathCoordinator'
import { MarkdownPostProcessorContext, Notice, Plugin, Platform } from 'obsidian'
import { setKeyboardDiagnostics } from '@/helpers/keyboardDiagnostics'
import { applySettingsLook } from '@/helpers/settingsLook'
import { enlargeSettingsWindow } from '@/helpers/settingsWindowSize'
import './styles.css'
import { GlobalStore } from './stores/GlobalStore'
import { registerFocusRelease } from './helpers/fieldFocus'
import { createApp, App as VueApp, watch } from 'vue'
import VueEntry from './App.vue'
import { AbeleConfig } from './services/AbeleConfig'
import { AgentRegistry } from './ai/agents/AgentRegistry'
import { mobileBackground } from './ai/mobileBackground'
import { SilentBackgroundAudio } from './ai/mobileBackgroundAudio'
import { appSuspension, bindAppSuspension } from './ai/appSuspension'
import './commands/createNoteInGroup'
import './commands/commentCommands'
import './commands/noteMenu'
import './commands/noteActions'
import './scripting/scriptPath'
import './templates/TemplateService'
import './editor/TaskPlugin'
import './editor/GalleryPlugin'
import './editor/galleryPostProcessor'
import '@/components/obsidian/markdownParts'
import './editor/MermaidPlugin'
import './editor/EditorSyntax'
import './mermaid/mermaidBlocks'
import './editor/FootnotePlugin'
import './editor/HighlightPlugin'
import './editor/highlightPostProcessor'
import '@/editor/CommentPlugin'
import './views/TimelineSidebarView'
import './views/TodoSidebarView'
import './views/AiSidebarView'
import './views/FinanceSidebarView'
import './views/AccountsSidebarView'
import { revealSidebarView } from './views/revealSidebarView'
import './views/TimeTrackingSidebarView'
import './views/ScriptRunsView'
import './views/UserDocsView'
import { registerChangelog } from './changelog/register'
import './views/ScriptView'
import './bases/ChartView'
import './analytics/sources/baseProbe'
import './bases/FindAndReplaceView'
import './bases/CalendarView'
import './bases/TimelineView'
import './views/CodeView'
import { registerDrawing } from './drawing/register'
import { registerCanvas } from './canvas/register'
import { registerReader } from './reader/register'
import { registerSlides } from './slides/register'
import { registerWord } from './word/register'
import { registerWorkbooks } from './spreadsheet/XlsxView'
import { registerPropertyWidgets } from './properties/register'
import { registerLinter } from './linter/register'
import { ChatService } from './ai/ChatService'
import { NodeService } from './node/NodeService'
import { AgentsService } from './agents/AgentsService'
import { closeAgents } from './agents/openAgents'
import { CommentService } from './ai/CommentService'
import './comments/register'
import { ScriptService } from './scripting/ScriptService'
import { AutomationService } from './automations/AutomationService'
import { ScriptViewService } from './scripting/view/ScriptViewService'
import { preserveLocalScriptVersions } from './scripting/trust/localScriptUpgrade'
import './scripting/formModal'
import './commands/utilityDialogs'
import './scripting/apiDocs'
import './scripting/view/viewDocs'
import { ScopeResolver } from './ai/ScopeResolver'
import { ChatStorage } from './ai/ChatStorage'
import './ai/chatBindingRenames'
import './ai/delegationIdentity'
import weekday from 'dayjs/plugin/weekday'
import updateLocale from 'dayjs/plugin/updateLocale'
import dayOfYear from 'dayjs/plugin/dayOfYear'
import dayjs from 'dayjs'
import { AbeleSettingTab } from './settings'
import './editor/HeaderExtension'
import { VaultWatcherWrapper } from './helpers/VaultWatcherWrapper'
import { exposeTestApi } from '@/testing/exposeTestApi'
import './helpers/vaultUtils'
import './helpers/runAfterSync'
import './helpers/protocolHandler'
import './helpers/linkHandler'
import './editor/ChartCodeblock'
import './editor/MapCodeblock'
import './ai/messageCards'
import { SnippetService } from './services/SnippetService'
import { startCalendars } from './calendars/start'
import { startExchangeRates } from './finance/rates/start'
import '@/audio/voiceModal'
import { registerLineLinks } from './lineLinks/register'
import './checkboxes/register'
import './columns/register'
import './columns/styles.css'
import { registerAttachmentRules } from './media/attachmentRulesHook'
import { registerNotePlaces } from './notePlaces/register'
import { registerGithub } from '@/github/register'
import { secrets, setSecrets } from '@/secrets/SecretStore'
import { createPluginSecrets } from '@/secrets/host'
import { initializeDestinations, checkRequestDestinations } from '@/secrets/destinations'
import { setRequestGuard } from '@/helpers/http'
import { markLoad } from '@/helpers/loadMarks'
import { uninstallUntrustedGuard } from '@/markdown/renderUntrusted'
import { beginStartup, startupStep, startupStepAsync } from '@/helpers/startupSteps'
import { startStartupScripts } from '@/scripting/startupRunner'
import { claimVueSetters } from '@/helpers/vueGlobals'
import '@/ai/openChat'
import '@/ai/chatFileLeaves'
import { ChatSearchIndex } from '@/ai/ChatSearchIndex'
import { applyQuickButton, setQuickButton } from '@/quickButton/mount'
import '@/quickButton/open'
import { HeaderCommands } from '@/headerButtons/viewActions'
import '@/composables/useFooterFold'
import '@/composables/useFooterView'
import { prepareTokenConnections } from './sync/tokenRegistryPreparation'
import { prepareHostSyncStorage } from './sync/hostSyncStorage'
import { recordTeardown } from './sync/teardownBarrier'
import { tokenUi, TokenUi } from './sync/tokenUi'
import { openDeviceReviews } from './sync/openDeviceReviews'
import { transportOf } from './sync/environment'
import { watchTheFront } from './sync/phone'
import { TokenEngines } from './sync/tokenEngines'
import { renderStatus, type SyncStatus } from './sync/status'
import { unrenderKit } from './components/obsidian/mount'
import { tokenStatus } from './sync/tokenStatus'
import { mountPhoneSyncAction } from './sync/phoneSyncAction'
import { openAbeleSettings } from './components/settings/settingsTab'
// Keep the extracted section last so its dependencies do not reorder the existing styles.
import { registerCoreCommands } from '@/startup/registerCoreCommands'
import { registerViews } from '@/startup/registerViews'
import { registerBasesViews } from '@/startup/registerBasesViews'
import { registerEditor } from '@/startup/registerEditor'
import { registerWorkspaceEvents } from '@/startup/registerWorkspaceEvents'
import { registerLinks } from '@/startup/registerLinks'
import { registerAiFeatures } from '@/startup/registerAiFeatures'

// Every module imported above has run its top-level code by now. See `helpers/loadMarks.ts`.
markLoad('evalEnd')
// Vue has registered its global setters, so the last ones are this bundle's. Taken back on
// unload, or every reload keeps the whole previous bundle alive. See `helpers/vueGlobals.ts`.
const releaseVueSetters = claimVueSetters()

export default class AbelePlugin extends Plugin {
  private tokenEngines: TokenEngines | null = null
  readonly tokenHostStartup: { state: 'starting' | 'ready' | 'failed'; error?: string } = {
    state: 'starting',
  }
  private syncStarted = false
  private vueApp: VueApp | null = null
  private headerCommands: HeaderCommands | null = null

  initializeVue() {
    const rootContainer = createDiv()
    rootContainer.id = 'abele-vue-root'
    document.body.appendChild(rootContainer)

    this.vueApp = createApp(VueEntry)

    // Catch errors from Teleport unmounting when CM6 removes widget DOM
    let suppressedSeen = false
    this.vueApp.config.errorHandler = (err, instance, info) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (
        msg.includes('removeChild') ||
        msg.includes('parentNode') ||
        msg.includes('bum') ||
        msg.includes('emitsOptions')
      ) {
        // The first one is said out loud: the same errors are also what a component left
        // broken throws on every update, and then this is the only trace of it.
        if (!suppressedSeen) {
          suppressedSeen = true
          console.warn(
            '[Abele] Vue error silenced as Teleport clean-up (only the first is shown):',
            err,
            info
          )
        } else {
          console.debug('[Abele] Suppressed Teleport cleanup error:', msg)
        }
        return
      }
      console.error('[Abele] Vue error:', err, info)
    }

    this.vueApp.mount(rootContainer)
  }

  getVueApp(): VueApp {
    return this.vueApp
  }

  /**
   * Device sync, and the one line of it a user sees.
   *
   * Started on `onLayoutReady` beside the other services: the engine's first act is to list
   * the vault, and Obsidian's file index is not complete before then. The service decides for
   * itself whether there is anything to sync — a vault that was never connected to a server
   * builds no engine, and the status bar item stays out of sight.
   */
  private initSync(): void {
    this.syncStarted = true
    this.tokenEngines?.start()

    const statusEl = this.addStatusBarItem()
    statusEl.addClass('mod-clickable')
    this.register(() => unrenderKit(statusEl))
    // The log rather than a sync: the indicator already says what sync is doing, so the
    // question a click carries is *why* — which is what the log answers. Syncing on demand is
    // a command and a button in the settings, neither of which is one stray click away.
    this.registerDomEvent(statusEl, 'click', () => {
      openAbeleSettings(this.app, 'sync')
    })

    // A vault that syncs with nothing shows nothing: most people never connect one, and a
    // status bar reading "Not connected" for ever is a line of chrome doing no work.
    const phone = Platform.isPhone
      ? mountPhoneSyncAction(this, () => openAbeleSettings(this.app, 'sync'))
      : null
    const paint = (status: SyncStatus): void => {
      statusEl.toggle(status.state !== 'disconnected')
      renderStatus(statusEl, status)
      phone?.(status)
    }
    this.register(
      watch(
        () => [
          tokenUi.value?.rows.value,
          tokenUi.value?.activity.value,
          tokenUi.value?.candidates.value,
          tokenUi.value?.questions.value,
        ],
        () => {
          const status = tokenStatus(tokenUi.value)
          paint(status)
        },
        { immediate: true }
      )
    )

    // Here, with the rest of sync, and not beside the agent's commands: those are registered
    // only once the agent is switched on, and sync has nothing to do with it — on a vault
    // without the agent these four were simply missing from the palette.
    this.addCommand({
      id: 'sync-now',
      name: t('commands.sync-now'),
      icon: 'refresh-cw',
      callback: () => {
        // The service says so in the log and moves nothing; from the palette there is no
        // Sync tab in view to say it, so it is said here too.
        const ui = tokenUi.value
        if (ui?.rows.value.length && ui.rows.value.every((one) => one.paused)) {
          new Notice('Sync is paused. Resume it to sync this device.')
          return
        }
        if (ui)
          void Promise.allSettled(
            ui.rows.value.filter((one) => !one.paused).map((one) => ui.sync(one.id))
          ).then((results) => {
            if (results.some((one) => one.status === 'rejected'))
              new Notice('Some connections need attention. Open sync settings for details.')
          })
      },
    })

    this.addCommand({
      id: 'sync-pause-resume',
      name: t('commands.sync-pause-resume'),
      icon: 'pause-circle',
      callback: () => {
        const ui = tokenUi.value
        if (ui) {
          const paused = !ui.rows.value.every((one) => one.paused)
          void Promise.allSettled(ui.rows.value.map((one) => ui.pause(one.id, paused))).then(
            (results) => {
              if (results.some((one) => one.status === 'rejected'))
                new Notice(
                  'Some connections could not be paused or resumed. Open sync settings for details.'
                )
            }
          )
        }
      },
    })

    this.addCommand({
      id: 'sync-log',
      name: t('commands.sync-log'),
      icon: 'scroll-text',
      callback: () => {
        openAbeleSettings(this.app, 'sync')
      },
    })

    this.addCommand({
      id: 'sync-deleted-files',
      name: t('commands.sync-deleted-files'),
      icon: 'trash-2',
      callback: () => {
        GlobalStore.getInstance().deletedFilesModalOpened.value = true
      },
    })
  }

  async onload() {
    markLoad('onloadStart')
    try {
      // Every step below runs on its own: one that throws is named in the console and the rest of
      // the start goes on, instead of leaving the sidebars and everything after it unregistered.
      beginStartup()
      startupStep('locale', () =>
        initializeLocale(process.env.NODE_ENV !== 'production' ? 'en' : hostLocale().format)
      )
      await startupStepAsync('locale catalog', () =>
        initializePluginLocale(this, currentLocale().format)
      )
      // First, so it runs before every other layout-ready callback registered below.
      this.app.workspace.onLayoutReady(() => markLoad('layoutStart'))
      dayjs.extend(weekday)
      dayjs.extend(updateLocale)
      dayjs.extend(dayOfYear)

      AbeleConfig.getInstance().init(this)
      ;(window as any).process = (window as any).process || {
        env: { NODE_ENV: 'production' },
      } // Ensure process is defined for Node.js compatibility

      await startupStepAsync('settings', () => AbeleConfig.getInstance().loadSettings())
      startupStep('zen mode', () => registerZen(this))
      startupStep('mobile background', () => {
        if (!Platform.isMobile) return
        this.register(bindAppSuspension(appSuspension, document, window))
        mobileBackground.install(new SilentBackgroundAudio())
        this.register(
          watch(
            AbeleConfig.getInstance().version,
            () =>
              mobileBackground.configure(true, {
                whileAgents: AbeleConfig.getInstance().ai.backgroundWhileAgents === true,
                always: AbeleConfig.getInstance().ai.backgroundAlways === true,
              }),
            { immediate: true, flush: 'sync' }
          )
        )
        this.registerDomEvent(document, 'pointerdown', () => mobileBackground.activate())
        this.registerDomEvent(document, 'keydown', () => mobileBackground.activate())
        this.register(() => mobileBackground.destroy())
      })
      // Before either sync host can write: preserve local execution decisions, not access state.
      await startupStepAsync('local script approvals', () => preserveLocalScriptVersions(this.app))
      // Settings were just replaced wholesale; anything resolving an agent must see the new set.
      startupStep('agents', () => AgentRegistry.getInstance().notifyConfigReloaded())

      // Before anything asks for a key. Opening costs one decryption: the passphrase was turned
      // into a key when this device was unlocked, not now.
      const secretStore = createPluginSecrets(this)
      setSecrets(secretStore)
      await startupStepAsync('sync connection', async () => {
        let hostStorage: Awaited<ReturnType<typeof prepareHostSyncStorage>> | undefined
        const config = AbeleConfig.getInstance(),
          loaded = config.takeLoadedSync()
        try {
          const registry = await prepareTokenConnections(
            this.app,
            {
              get: (id) => secretStore.getLocal(id),
              remove: (id) => secretStore.forgetLocal(id),
            },
            loaded?.sync,
            window.indexedDB
          )
          hostStorage = await prepareHostSyncStorage(this.app, window.indexedDB)
          if (loaded !== null) {
            config.acknowledgeSyncMigration()
            await config.rewrite()
          }
          const reviewKey = 'abele-sync-device-review-id-v1'
          let reviewId = this.app.loadLocalStorage(reviewKey)
          if (reviewId == null) {
            reviewId = crypto.randomUUID()
            this.app.saveLocalStorage(reviewKey, reviewId)
            if (this.app.loadLocalStorage(reviewKey) !== reviewId)
              throw new Error('Device review identity was not stored')
          }
          if (typeof reviewId !== 'string')
            throw new Error('Device review identity requires recovery')
          const reviews = await openDeviceReviews(window.indexedDB, reviewId, {
            configRoots: [this.app.vault.configDir],
            scriptsFolder: AbeleConfig.getInstance().ai.scriptsFolder || 'Scripts',
          })
          const ui = new TokenUi(
            registry,
            {
              get: (id) => secretStore.getLocal(id) || null,
              set: (id, value) => secretStore.setLocal(id, value),
              remove: (id) => secretStore.forgetLocal(id),
            },
            (input, init) => transportOf({})(input, init),
            reviews
          )
          tokenUi.value = ui
          this.tokenEngines = new TokenEngines(
            this.app,
            ui,
            (reference) => secretStore.getLocal(reference) || null,
            {},
            AbeleConfig.getInstance().ai.scriptsFolder || 'Scripts',
            {
              path: `${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`}/data.json`,
              arrived: () => {
                void this.onExternalSettingsChange()
              },
            }
          )
          this.register(
            AbeleConfig.getInstance().onSaved(() => {
              if (this.syncStarted)
                void this.tokenEngines
                  ?.updateScriptsFolder(AbeleConfig.getInstance().ai.scriptsFolder || 'Scripts')
                  .catch(
                    () =>
                      new Notice(
                        'Sync configuration could not be updated. Restart Obsidian to recover.'
                      )
                  )
            })
          )
          this.tokenEngines.announce()
          this.tokenHostStartup.state = 'ready'
          watchTheFront(this, Platform.isMobile, {
            held: () => this.tokenEngines?.presentReviews(),
            sync: (visible) => {
              void this.tokenEngines?.foreground(visible)
            },
          })
          ui.openFile = async (path) => {
            await openSyncedFile(
              path,
              async (file) => {
                await this.tokenEngines?.hydrate(file)
              },
              async (file) => {
                await this.app.workspace.openLinkText(file, '', false)
              },
              (message) => {
                new Notice(message)
              }
            )
          }
          this.register(() => {
            if (tokenUi.value === ui) tokenUi.value = null
            const stopping = this.tokenEngines?.close() ?? Promise.resolve()
            const closed = stopping.finally(() => {
              try {
                reviews.close()
              } finally {
                hostStorage?.close()
              }
            })
            recordTeardown(this.app, closed)
            void closed.catch(() => console.error('[Abele] token sync shutdown requires recovery'))
          })
          this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
              const offloads = tokenOffloadsOf(this.app.vault, pathCoordinatorOf(this.app.vault))
              if (file && !offloads.isOffloaded(offloads.originalPath(file.path)))
                void Promise.resolve(this.tokenEngines?.hydrate(file.path))
                  .then(() => ui.opened(file.path))
                  .catch(
                    () =>
                      new Notice(
                        'The private file question could not be opened. Reopen the note to try again.'
                      )
                  )
            })
          )
          await ui.refreshReviews()
        } catch (error) {
          if (!this.tokenEngines) {
            hostStorage?.close()
            this.tokenHostStartup.state = 'failed'
            this.tokenHostStartup.error =
              (error as Error)?.message || 'Token host initialization failed'
          }
          console.error(
            '[Abele] retired access cleanup requires recovery',
            (error as Error)?.message
          )
        }
      })
      await startupStepAsync('synced secrets', () =>
        secretStore.load().catch((e) => {
          console.error('[Abele] the synced secrets could not be opened', (e as Error)?.message)
        })
      )
      // After the store: a token moved out of the settings lands in it when it is open here.
      await startupStepAsync('legacy secrets', () => AbeleConfig.getInstance().moveLegacySecrets())
      // Announce before layout-ready so cold-start links wait for the first pull.

      startupStep('settings look', () => applySettingsLook(AbeleConfig.getInstance()))
      // Obsidian opens its settings window at 900×700 on any screen; ask for more where there is room.
      startupStep('settings window', () => {
        if (Platform.isDesktopApp)
          this.register(enlargeSettingsWindow((this.app as any).setting ?? {}, window))
      })
      this.app.workspace.onLayoutReady(() => startupStep('sync', () => this.initSync()))

      // The store takes the week start and the rest of what it draws from out of the settings.
      startupStep('store', () => GlobalStore.getInstance().init(this.app))
      initializeDestinations(AbeleConfig.getInstance())
      setRequestGuard((request) => checkRequestDestinations(request, AbeleConfig.getInstance()))
      // Under every tool that writes, so a chat can take back what its agent changed.
      startupStep('change tracker', () => ChangeTracker.install(this.app))

      // External calendars: kept events at layout-ready, then read over the network on a timer.
      startupStep('calendars', () => startCalendars(this))
      // Today's exchange rates: the kept table at layout-ready, a new one once a day.
      startupStep('exchange rates', () => startExchangeRates(this))

      // Development builds expose plugin internals to the e2e suite, which drives the app
      // through `obsidian eval`. Vite inlines NODE_ENV, so in a production build this folds to
      // `if (false)` and the import is tree-shaken away. It must stay a static import: a
      // dynamic one makes Rollup emit a separate chunk, and the install scripts copy only
      // main.js, which would ship a stub that cannot resolve its own bundle.
      if (process.env.NODE_ENV !== 'production') {
        exposeTestApi(this)
      }

      // Vault files and metadata cache are not fully available during onload().
      // Deferring TasksList creation until layout is ready ensures getMarkdownFiles()
      // and getFileCache() return complete data.
      // One step each: an index that throws no longer keeps the ones after it from being built.
      this.app.workspace.onLayoutReady(() => {
        startupStep('tasks index', () => GlobalStore.getInstance().initTasksList())
        startupStep('finance index', () => GlobalStore.getInstance().initFinance())
        startupStep('time tracking index', () => GlobalStore.getInstance().initTimeTracking())
        void startupStepAsync('css snippets', () => SnippetService.getInstance().init())
        startupStep('node mailboxes', () => NodeService.getInstance().resumeDelegations())
        // Restore saved presentations without enabling model execution or optional AI tools.
        void startupStepAsync('chat tabs', () => ChatService.getInstance().restoreTabs())
      })

      this.addSettingTab(new AbeleSettingTab(this.app, this))

      // On a phone a tap beside a field does not take its focus away, so the keyboard stays up.
      registerFocusRelease(this)

      console.debug('Abele Plugin loaded.')

      startupStep('views', () => this.registerViews())

      // GitHub issues, pull requests, discussions and files in tabs of their own; off by default.
      startupStep('github', () => registerGithub(this))

      // Books from the vault — `.epub` — in a reader tab of their own.
      startupStep('books', () => registerReader(this))
      startupStep('word', () => registerWord(this))
      startupStep('workbooks', () => registerWorkbooks(this))

      // Drawings: an SVG made by the plugin opens in a tab to draw on, pen, marker and eraser.
      startupStep('drawings', () => registerDrawing(this))
      startupStep('canvas diagrams', () => registerCanvas(this))
      startupStep('presentations', () => registerSlides(this))

      // Links to lines of a note — `[[Note#L10-L12]]` — open at those lines; and a way to copy one.
      startupStep('line links', () => registerLineLinks(this))

      // Notes come back where they were left, unless opened at a place of their own.
      startupStep('note places', () => registerNotePlaces(this))

      // Pasted and dropped files of notes under a ruled folder go to that rule's folder.
      startupStep('attachment folders', () => registerAttachmentRules(this))

      // Some properties drawn by the plugin: wallet balances, sums in numbers, file cards.
      startupStep('property widgets', () => registerPropertyWidgets(this))

      // The linter: notes checked against rules of the person's choosing, a tab listing what is wrong.
      startupStep('linter', () => registerLinter(this))

      startupStep('bases views', () => this.registerBasesViews())

      startupStep('vue', () => this.initializeVue())

      startupStep('editor', () => this.registerEditor())

      startupStep('workspace events', () => this.registerWorkspaceEvents())

      startupStep('commands', () => this.registerCommands())
      startupStep('changelog', () => registerChangelog(this))

      // AI Agent — conditional on settings, and switched on later as often as at startup
      startupStep('agent', () => this.syncAiFeatures())

      startupStep('links', () => this.registerLinks())
    } finally {
      // Last even with AI disabled or an unexpected startup failure. These bracket synchronous
      // registration/layout work, not the asynchronous jobs launched by the callbacks.
      this.app.workspace.onLayoutReady(() => {
        this.starting = false
        markLoad('layoutEnd')
      })
      markLoad('onloadEnd')
    }
  }

  /** The panes the plugin opens: the sidebars, the code and documentation tabs. */
  private registerViews() {
    registerViews(this)
  }

  /** The views the plugin adds to bases. */
  private registerBasesViews() {
    registerBasesViews(this)
  }

  /** What the plugin adds to notes: editor extensions, post-processors and code blocks. */
  private registerEditor() {
    registerEditor(this)
  }

  /** The plugin's answers to what happens in the workspace, and its menu items. */
  private registerWorkspaceEvents() {
    registerWorkspaceEvents(this)
  }

  /** The commands and ribbon icons that are there whatever the settings. */
  private registerCommands() {
    registerCoreCommands(this)
  }

  /** `obsidian://abele` links, and the default template for notes made from outside. */
  private registerLinks() {
    registerLinks(this)
  }

  /** True once the agent's commands and ribbon icon are on the screen. */
  private aiFeaturesRegistered = false

  /** True once the scripts in the vault have been read and turned into commands. */
  private scriptsStarted = false
  private scriptsFolderStarted = ''
  private scriptStartGeneration = 0

  /**
   * True until the last of this start's layout-ready callbacks: scripts switched on after that
   * are switched on in a running session, which is no start, and run no startup scripts.
   */
  private starting = true

  /**
   * Puts the agent's commands and ribbon icon up, once the setting says so.
   *
   * Called at load and again after every settings save, because turning the agent on is
   * something people do on a fresh install — and until now nothing appeared until Obsidian was
   * restarted, which left the setting looking as if it had not taken.
   *
   * Only one way round. Obsidian has no way to take a command or a ribbon icon back, so
   * turning the agent off still needs a restart to clear them; leaving them up is the smaller
   * of the two annoyances, and the commands do nothing without a model configured anyway.
   */
  syncAiFeatures() {
    const { ai } = AbeleConfig.getInstance()
    if (
      this.scriptsStarted &&
      (!ai.enabled || !ai.scriptsEnabled || this.scriptsFolderStarted !== ai.scriptsFolder)
    ) {
      this.scriptsStarted = false
      this.scriptStartGeneration = (this.scriptStartGeneration ?? 0) + 1
      AutomationService.destroy()
      ScriptService.destroy()
    }
    if (!ai.enabled) return

    if (!this.aiFeaturesRegistered) {
      this.aiFeaturesRegistered = true
      this.registerAiFeatures()
    }

    // Scripts are a second switch behind the first, and turning that one on used to need a
    // restart of its own.
    if (ai.scriptsEnabled && !this.scriptsStarted) {
      this.scriptsStarted = true
      this.scriptsFolderStarted = ai.scriptsFolder
      const generation = (this.scriptStartGeneration = (this.scriptStartGeneration ?? 0) + 1)
      this.app.workspace.onLayoutReady(() => {
        if (!this.scriptsStarted || generation !== this.scriptStartGeneration) return
        const atStart = this.starting
        // A settings migration may start this before view-type registration on a reload.
        // Keep the host ready before the index can launch anything, on that path too.
        ScriptViewService.getInstance()
        ScriptService.getInstance().init()
        // Automations name their script, so they wait for the index that finds it.
        void ScriptService.getInstance().ready.then(() => {
          // Not after an unload that came first.
          if (
            AbeleConfig.getInstance().plugin === this &&
            this.scriptsStarted &&
            generation === this.scriptStartGeneration
          ) {
            AutomationService.getInstance().start(this.app)
          }
        })
        // Every start of the plugin, a reload included; they wait for the index themselves.
        if (atStart) {
          void startStartupScripts(this.app, ScriptService.getInstance()).catch((e) =>
            console.error('[Abele] startup scripts could not be run', e)
          )
        }
      })
    }
  }

  registerAiFeatures() {
    registerAiFeatures(this, (commands) => {
      this.headerCommands = commands
    })
  }

  onunload() {
    uninstallUntrustedGuard()
    setRequestGuard(undefined)
    setSecrets(null)
    document.body.classList.remove('abele-full-width-sidebars', 'abele-half-width-sidebars')
    setKeyboardDiagnostics(false)
    setQuickButton(false)
    this.headerCommands?.stop()
    this.headerCommands = null
    // Unmount Vue BEFORE store cleanup so Teleport components unmount cleanly
    if (this.vueApp) {
      this.vueApp.unmount()
      document.getElementById('abele-vue-root')?.remove()
    }
    // The engine has a socket, a watcher and timers of its own, and a state database that must
    // be closed; the sync in flight is waited for rather than cut off.
    SnippetService.destroy()
    AutomationService.destroy()
    ScriptService.destroy()
    ScriptViewService.destroy()
    closeAgents()
    CommentService.getInstance().destroy()
    ChatService.getInstance().destroy()
    AgentsService.destroyCurrent()
    ChangeTracker.get()?.uninstall()
    ScopeResolver.getInstance().destroy()
    ChatStorage.destroy()
    ChatSearchIndex.destroy()
    GlobalStore.getInstance().destroy()
    AbeleConfig.getInstance().destroy()
    VaultWatcherWrapper.destroy()
    if (process.env.NODE_ENV !== 'production') {
      delete (window as { __abeleTest?: unknown }).__abeleTest
    }
    releaseVueSetters()
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

  /**
   * A chat file belongs in the sidebar, not in a leaf.
   *
   * A comment file is the same idea taken one step further: it has no reader of its own until
   * its card is on screen, so opening it by hand is taken as asking for the chat. Expansion is
   * the route rather than `openChatFile` because `CommentService` may already have a session
   * writing that file, and two writers on one log interleave records.
   */
  async activateView(viewType: string) {
    await revealSidebarView(this.app, viewType)
  }

  /**
   * `data.json` changed on disk without this plugin writing it — Abele Sync, Obsidian Sync or
   * another sync tool bringing another device's copy. Without this the settings loaded at
   * startup stay in memory and the next save, from anywhere, writes them back over what arrived.
   *
   * Called by Obsidian and, after a sync run that wrote the file, by the sync as well; the
   * second call for one file reloads nothing (`AbeleConfig.reloadSettings` says why both come).
   */
  async onExternalSettingsChange() {
    if (!(await AbeleConfig.getInstance().reloadSettings())) return
    // What arrived may hold another device's secrets, or have dropped this one's newest:
    // opening it again merges the two and writes back whatever the file is missing.
    await secrets()
      .load()
      .catch((e) =>
        console.error('[Abele] the synced secrets could not be reopened', (e as Error)?.message)
      )
    await AbeleConfig.getInstance().moveLegacySecrets()
    AgentRegistry.getInstance().notifyConfigReloaded()
    GlobalStore.getInstance().applySettings()
    this.syncAiFeatures()
    if (this.syncStarted)
      await this.tokenEngines?.updateScriptsFolder(
        AbeleConfig.getInstance().ai.scriptsFolder || 'Scripts'
      )
    applyQuickButton()
    applySettingsLook(AbeleConfig.getInstance())
  }
}
