import { Notice, type App } from 'obsidian'
import { watch, type WatchStopHandle } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { AutomationEngine } from './AutomationEngine'
import { LocalWrites } from './LocalWrites'
import { NoteEventBus } from './NoteEventBus'
import { runAutomation } from './runAutomation'

/**
 * Automations, switched on and off with their settings.
 *
 * Started once scripts are, and listening only while at least one rule is on: the bus keeps a
 * copy of every note's frontmatter and the vault's write methods are wrapped while it listens,
 * and a vault with no automations should carry neither.
 */
export class AutomationService {
  private static instance: AutomationService | null = null

  private app: App | null = null
  private writes = new LocalWrites()
  private uninstall: (() => void) | null = null
  private bus: NoteEventBus | null = null
  private engine: AutomationEngine
  private stopWatching: WatchStopHandle | null = null
  private rulesKey = ''

  private constructor() {
    const config = AbeleConfig.getInstance()
    this.engine = new AutomationEngine({
      rules: () => config.automations,
      canRun: () => this.canRun(),
      run: (rule, event, chain) => runAutomation(rule, event, chain, this.writes),
      notify: (message) => new Notice(message, 15000),
    })
  }

  static getInstance(): AutomationService {
    if (!this.instance) this.instance = new AutomationService()
    return this.instance
  }

  static destroy(): void {
    this.instance?.stop()
    this.instance = null
  }

  /** Whether the bus is listening now — some rule is on and nothing forbids running. */
  get listening(): boolean {
    return !!this.bus?.isRunning
  }

  /**
   * Automations never run on defaults: a settings file that could not be read leaves the
   * defaults in memory, and the rules are not among them — but a rule arriving by any other
   * road while that is so is not the person's either.
   */
  private canRun(): boolean {
    const config = AbeleConfig.getInstance()
    return !config.settingsUnreadable && config.ai.enabled && config.ai.scriptsEnabled
  }

  start(app: App): void {
    if (this.app) return
    this.app = app
    this.bus = new NoteEventBus(app, (path) => this.writes.originOf(path))
    this.bus.subscribe((change) => this.engine.handle(change))
    this.stopWatching = watch(AbeleConfig.getInstance().version, () => this.refresh())
    this.refresh()
  }

  /** Called whenever the settings change: listens or stops, and lifts a pause on an edit. */
  refresh(): void {
    if (!this.app || !this.bus) return
    const config = AbeleConfig.getInstance()

    const key = JSON.stringify(config.automations)
    if (key !== this.rulesKey) {
      this.rulesKey = key
      this.engine.reset()
    }

    const wanted = this.canRun() && config.automations.some((r) => r.enabled && r.scriptName)
    if (wanted && !this.bus.isRunning) {
      this.uninstall = this.writes.install(this.app)
      this.bus.start()
    } else if (!wanted && this.bus.isRunning) {
      this.bus.stop()
      this.uninstall?.()
      this.uninstall = null
    }
  }

  stop(): void {
    this.stopWatching?.()
    this.stopWatching = null
    this.bus?.stop()
    this.bus = null
    this.uninstall?.()
    this.uninstall = null
    this.engine.dispose()
    this.app = null
  }
}
