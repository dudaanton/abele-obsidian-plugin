import {
  isTaskKind,
  type AutomationEvent,
  type AutomationRule,
  type Frontmatter,
  type NoteChange,
} from './types'

/**
 * Which rule runs for which change, and how often.
 *
 * Everything that keeps automations safe is here, away from Obsidian so it can be tested:
 * a rule never answers its own write, a chain of rules setting each other off stops after
 * three, one note is not run for more often than its rule allows, and a burst of runs that can
 * only be a loop pauses all of them.
 */

/** A rule set off by a rule set off by a rule is as deep as it goes. */
export const MAX_CHAIN = 3
/** More runs than this in a minute is taken for a loop. */
export const MAX_RUNS_PER_MINUTE = 30

export interface EngineDeps {
  rules(): AutomationRule[]
  /** False while automations must not run at all — the settings failed to load, say. */
  canRun(): boolean
  /** Runs the rule's script. `chain` is to be carried by whatever the script writes. */
  run(rule: AutomationRule, event: AutomationEvent, chain: string[]): Promise<void>
  notify(message: string): void
}

/** Whether a vault path sits under a folder, at any depth. `Films` does not hold `Filmsy/`. */
function isInside(path: string, folder: string): boolean {
  const prefix = folder.trim().replace(/^\/+|\/+$/g, '')
  return prefix !== '' && path.startsWith(prefix + '/')
}

const text = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return value == null ? '' : JSON.stringify(value)
}

function propertyHolds(fm: Frontmatter | null, property: string, value: string): boolean {
  const actual = fm?.[property.trim()]
  const values = Array.isArray(actual) ? actual : [actual]
  const wanted = value.trim().toLowerCase()
  if (!wanted) return values.some((v) => text(v) !== '')
  return values.some((v) => text(v).toLowerCase() === wanted)
}

/** Whether this rule is about this change, before any question of how often. */
export function ruleMatches(rule: AutomationRule, change: NoteChange): boolean {
  if (!rule.enabled || !rule.scriptName) return false
  if (!change.kinds.includes(rule.event)) return false
  if (change.origin === 'external' && !rule.includeExternal) return false

  if (!isTaskKind(rule.event) && rule.noteTypes.length) {
    const type = change.type.trim().toLowerCase()
    if (!rule.noteTypes.some((t) => t.trim().toLowerCase() === type)) return false
  }
  if (rule.folders.length && !rule.folders.some((folder) => isInside(change.path, folder))) {
    return false
  }
  if (rule.property.trim()) {
    const fm = change.after ?? change.before
    if (!propertyHolds(fm, rule.property, rule.value)) return false
  }
  return true
}

interface Slot {
  last: number
  pending: NoteChange | null
  timer: number | null
}

/** Several changes waited out as one: from the first one's before to the last one's after. */
function fold(first: NoteChange, next: NoteChange): NoteChange {
  return {
    ...next,
    kinds: [...new Set([...first.kinds, ...next.kinds])],
    before: first.before,
    changed: [...new Set([...first.changed, ...next.changed])],
    bodyChanged: first.bodyChanged || next.bodyChanged,
  }
}

export class AutomationEngine {
  private slots = new Map<string, Slot>()
  private recent: number[] = []
  private paused = false

  constructor(private readonly deps: EngineDeps) {}

  handle(change: NoteChange): void {
    if (!this.deps.canRun()) return
    if (change.chain.length >= MAX_CHAIN) {
      console.debug('[Abele] automation chain cut', change.chain, change.path)
      return
    }
    for (const rule of this.deps.rules()) {
      if (change.chain.includes(rule.id)) continue
      if (!ruleMatches(rule, change)) continue
      this.throttle(rule, change)
    }
  }

  /** Lifts a pause and forgets the per-note waits: the rules were just changed. */
  reset(): void {
    this.paused = false
    this.recent = []
    for (const slot of this.slots.values()) if (slot.timer) window.clearTimeout(slot.timer)
    this.slots.clear()
  }

  dispose(): void {
    this.reset()
  }

  private throttle(rule: AutomationRule, change: NoteChange): void {
    const key = `${rule.id}\u0000${change.path}`
    const ms = rule.throttleSeconds * 1000
    const now = Date.now()
    const slot = this.slots.get(key)

    if (!ms || !slot || now - slot.last >= ms) {
      if (ms) this.slots.set(key, { last: now, pending: null, timer: null })
      this.fire(rule, change)
      return
    }

    slot.pending = slot.pending ? fold(slot.pending, change) : change
    if (slot.timer) return
    slot.timer = window.setTimeout(
      () => {
        slot.timer = null
        const waited = slot.pending
        slot.pending = null
        if (!waited) return
        slot.last = Date.now()
        // The rule may have been changed or switched off while this waited.
        const current = this.deps.rules().find((r) => r.id === rule.id)
        if (current && this.deps.canRun() && ruleMatches(current, waited)) {
          this.fire(current, waited)
        }
      },
      slot.last + ms - now
    )
  }

  private fire(rule: AutomationRule, change: NoteChange): void {
    if (this.paused) return

    const now = Date.now()
    this.recent = this.recent.filter((at) => now - at < 60_000)
    if (this.recent.length >= MAX_RUNS_PER_MINUTE) {
      this.paused = true
      this.deps.notify(
        `Abele paused automations: more than ${MAX_RUNS_PER_MINUTE} ran within a minute, ` +
          'which looks like a loop. They start again when an automation is changed in ' +
          'settings, or when Obsidian restarts. Script runs lists what ran.'
      )
      return
    }
    this.recent.push(now)

    const { chain, ...rest } = change
    const event: AutomationEvent = {
      ...rest,
      kind: rule.event,
      rule: { id: rule.id, name: rule.name },
    }
    void this.deps.run(rule, event, [...chain, rule.id]).catch((err) => {
      console.error(`[Abele] automation "${rule.name}" failed`, err)
    })
  }
}
