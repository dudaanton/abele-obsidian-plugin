/**
 * The linter's settings, kept under `linter` in the plugin's settings: folders it never looks in,
 * and for each rule whether it runs, how bad a finding is, where it applies and its parameters.
 *
 * A rule nobody has touched has no entry and runs as it ships. Pure, so what a settings file may
 * hold — from an older version, another device, a hand edit — is tested without an app.
 */
import type { LintParams, LintRule, LintSeverity } from './types'
import { defaultParams } from './rules'

export interface LintRuleSetting {
  enabled: boolean
  severity: LintSeverity
  /** Folders or globs the rule applies in; empty for everywhere. */
  folders: string[]
  /** Folders or globs it leaves alone, inside those. */
  exclude: string[]
  /** Note types (the `type` property) it applies to; empty for any note. */
  types: string[]
  /** A property the note must have — with this value, when one is given. Empty for any note. */
  property: string
  value: string
  params: LintParams
}

export interface LinterSettings {
  /** Folders or globs no rule looks in: templates, attachments, an archive. */
  exclude: string[]
  /** By rule id: a built-in's, or `script:<name>` for a script's. */
  rules: Record<string, LintRuleSetting>
}

export const DEFAULT_LINTER_SETTINGS: LinterSettings = { exclude: [], rules: {} }

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter(Boolean)
    : []
const text = (value: unknown): string => (typeof value === 'string' ? value : '')

function ruleSettingFrom(raw: unknown): LintRuleSetting | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const params =
    r.params && typeof r.params === 'object' && !Array.isArray(r.params) ? r.params : {}
  return {
    enabled: r.enabled !== false,
    severity: r.severity === 'warning' ? 'warning' : 'error',
    folders: strings(r.folders),
    exclude: strings(r.exclude),
    types: strings(r.types),
    property: text(r.property).trim(),
    value: text(r.value).trim(),
    params: { ...(params as LintParams) },
  }
}

export function linterSettingsFrom(stored?: unknown): LinterSettings {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>
  const rules: Record<string, LintRuleSetting> = {}
  if (s.rules && typeof s.rules === 'object' && !Array.isArray(s.rules)) {
    for (const [id, raw] of Object.entries(s.rules as Record<string, unknown>)) {
      const setting = ruleSettingFrom(raw)
      if (id && setting) rules[id] = setting
    }
  }
  return { exclude: strings(s.exclude), rules }
}

/** How the rule runs here: its entry where there is one, as it ships where there is not. */
export function ruleSetting(settings: LinterSettings, rule: LintRule): LintRuleSetting {
  const own = settings.rules[rule.id]
  const params = { ...defaultParams(rule), ...(own?.params ?? {}) }
  if (own) return { ...own, params }
  return {
    enabled: rule.enabledByDefault,
    severity: rule.severity,
    folders: [],
    exclude: [],
    types: [],
    property: '',
    value: '',
    params,
  }
}

/** The settings with one rule's entry changed; the rest as they were. */
export function withRuleSetting(
  settings: LinterSettings,
  rule: LintRule,
  change: Partial<LintRuleSetting>
): LinterSettings {
  const next = { ...ruleSetting(settings, rule), ...change }
  return { ...settings, rules: { ...settings.rules, [rule.id]: next } }
}
