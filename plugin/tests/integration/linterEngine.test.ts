/**
 * The linter run against an in-memory vault: which notes a rule looks at, running in batches and
 * stopping, fixes written only over the text they were worked out from, and rules from scripts.
 */
import { describe, it, expect } from 'vitest'
import { load } from 'js-yaml'
import type { App } from 'obsidian'
import { buildFakeVault, type FakeFileSpec } from '../helpers/fakeVault'
import {
  activeRules,
  filesFor,
  fixFile,
  lintFiles,
  previewFix,
  type ActiveRule,
} from '@/linter/engine'
import { BUILTIN_RULES } from '@/linter/rules'
import { linterSettingsFrom, withRuleSetting, type LinterSettings } from '@/linter/settings'
import { loadScriptRule, scriptRuleStub } from '@/linter/scriptRules'
import { pathMatches } from '@/linter/scope'
import type { ParsedScript } from '@/scripting/types'
import type { LintRule } from '@/linter/types'

function spec(path: string, raw: string): FakeFileSpec {
  const m = /^---\n([\s\S]*?)\n?---/.exec(raw)
  let frontmatter: Record<string, unknown> | undefined
  try {
    frontmatter = m ? ((load(m[1]) as Record<string, unknown>) ?? {}) : undefined
  } catch {
    frontmatter = undefined
  }
  return { path, raw, frontmatter }
}

function vault(files: Record<string, string>) {
  return buildFakeVault(Object.entries(files).map(([p, raw]) => spec(p, raw)))
}

const rule = (id: string): LintRule => BUILTIN_RULES.find((r) => r.id === id)!

function only(settings: LinterSettings, ...ids: string[]): ActiveRule[] {
  let s = settings
  for (const r of BUILTIN_RULES) s = withRuleSetting(s, r, { enabled: ids.includes(r.id) })
  return activeRules(s, BUILTIN_RULES)
}

const GOOD = '---\ncreated: 2026-01-01\n---\n\nText\n'

describe('which notes are linted', () => {
  it('reads folders and globs, case aside', () => {
    expect(pathMatches('Journal/2026/Day.md', 'Journal')).toBe(true)
    expect(pathMatches('Journal/2026/Day.md', 'journal/')).toBe(true)
    expect(pathMatches('Journalism/Day.md', 'Journal')).toBe(false)
    expect(pathMatches('Notes/A.md', 'Notes/A')).toBe(true)
    expect(pathMatches('Projects/X/Tasks/T.md', 'Projects/*/Tasks')).toBe(true)
    expect(pathMatches('Projects/T.md', 'Projects/**/T.md')).toBe(true)
    expect(pathMatches('A/draft.excalidraw.md', '*.excalidraw.md')).toBe(false)
    expect(pathMatches('A/draft.excalidraw.md', '**/*.excalidraw.md')).toBe(true)
  })

  it('takes the vault, a folder or named notes, less what is excluded everywhere', () => {
    const app = vault({
      'A/one.md': GOOD,
      'A/two.md': GOOD,
      'B/three.md': GOOD,
      'Templates/t.md': 'x',
    }) as unknown as App
    const settings = linterSettingsFrom({ exclude: ['Templates'] })
    expect(filesFor(app, { kind: 'vault' }, settings).map((f) => f.path)).toEqual([
      'A/one.md',
      'A/two.md',
      'B/three.md',
    ])
    expect(filesFor(app, { kind: 'folder', path: 'A' }, settings).map((f) => f.path)).toEqual([
      'A/one.md',
      'A/two.md',
    ])
    expect(
      filesFor(app, { kind: 'notes', paths: ['Templates/t.md', 'nope.md'] }, settings).map(
        (f) => f.path
      )
    ).toEqual(['Templates/t.md'])
  })

  it('applies a rule only where it is set to, by folder, type and property', async () => {
    const app = vault({
      'Tasks/a.md': '---\ntype: task\n---\n# H\n',
      'Tasks/b.md': '---\ntype: note\n---\n# H\n',
      'Tasks/Done/c.md': '---\ntype: task\n---\n# H\n',
      'People/d.md': '---\ntype: task\nstatus: x\n---\n# H\n',
    }) as unknown as App
    let s = linterSettingsFrom({})
    s = withRuleSetting(s, rule('no-h1'), {
      folders: ['Tasks', 'People'],
      exclude: ['Tasks/Done'],
      types: ['task'],
    })
    const rules = only(s, 'no-h1')
    const run = await lintFiles(app, filesFor(app, { kind: 'vault' }, s), rules)
    expect(run.issues.map((i) => i.path).sort()).toEqual(['People/d.md', 'Tasks/a.md'])

    s = withRuleSetting(s, rule('no-h1'), { property: 'status', value: '' })
    const narrowed = await lintFiles(app, filesFor(app, { kind: 'vault' }, s), only(s, 'no-h1'))
    expect(narrowed.issues.map((i) => i.path)).toEqual(['People/d.md'])
  })

  it('does not read a note no rule looks at', async () => {
    const fake = vault({ 'A/x.md': '# H', 'B/y.md': '# H' })
    const app = fake as unknown as App
    let s = linterSettingsFrom({})
    s = withRuleSetting(s, rule('no-h1'), { folders: ['A'] })
    fake.resetStats()
    await lintFiles(app, filesFor(app, { kind: 'vault' }, s), only(s, 'no-h1'))
    expect(fake.stats.read).toBe(1)
  })
})

describe('a run', () => {
  it('places each finding: note, rule, line, severity, whether it can be fixed', async () => {
    const app = vault({ 'n.md': '---\na: 1\n---\n# Title\n' }) as unknown as App
    let s = linterSettingsFrom({})
    s = withRuleSetting(s, rule('no-h1'), { severity: 'warning' })
    const { issues } = await lintFiles(
      app,
      filesFor(app, { kind: 'vault' }, s),
      only(s, 'no-h1', 'frontmatter-present')
    )
    expect(issues).toEqual([
      {
        path: 'n.md',
        rule: 'no-h1',
        message: expect.any(String),
        line: 4,
        severity: 'warning',
        fixable: true,
      },
    ])
  })

  it('goes in batches, telling how far it is, and stops when asked', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 25; i++) files[`n${String(i).padStart(2, '0')}.md`] = '# H\n'
    const app = vault(files) as unknown as App
    const s = linterSettingsFrom({})
    const progress: number[] = []
    const controller = new AbortController()
    const run = await lintFiles(app, filesFor(app, { kind: 'vault' }, s), only(s, 'no-h1'), {
      batch: 10,
      signal: controller.signal,
      onProgress: (checked) => {
        progress.push(checked)
        if (checked >= 10) controller.abort()
      },
    })
    expect(progress).toEqual([10])
    expect(run.cancelled).toBe(true)
    expect(run.checked).toBe(10)
    expect(run.issues).toHaveLength(10)
  })
})

describe('fixing a note', () => {
  it('applies every fix in turn and writes once', async () => {
    const fake = vault({ 'Notes/My note.md': '# My note\n\nBody' })
    const app = fake as unknown as App
    const s = linterSettingsFrom({})
    const file = app.vault.getAbstractFileByPath('Notes/My note.md') as never
    ;(file as { stat: { ctime: number } }).stat.ctime = new Date(2026, 0, 2).getTime()
    fake.resetStats()
    const outcome = await fixFile(app, file, activeRules(s, BUILTIN_RULES))
    expect(outcome).toBe('fixed')
    expect(fake.stats.modify).toBe(1)
    expect(await app.vault.read(file)).toBe('---\ncreated: 2026-01-02\n---\n\nBody')
  })

  it('fixes one rule alone when asked', async () => {
    const app = vault({ 'n.md': '---\na: 1\n---\n# Title\n' }) as unknown as App
    const s = linterSettingsFrom({})
    const file = app.vault.getAbstractFileByPath('n.md') as never
    const { after } = await previewFix(
      app,
      file,
      activeRules(s, BUILTIN_RULES),
      'blank-line-after-frontmatter'
    )
    expect(after).toBe('---\na: 1\n---\n\n# Title\n')
  })

  it('leaves a note alone that changed while the fix was worked out', async () => {
    const fake = vault({ 'n.md': '# Title\n' })
    const app = fake as unknown as App
    const s = linterSettingsFrom({})
    const file = app.vault.getAbstractFileByPath('n.md') as never
    const slow: LintRule = {
      ...rule('no-h1'),
      id: 'slow',
      async fix(note) {
        await app.vault.modify(file, 'typed meanwhile')
        return note.content.replace('# ', '## ')
      },
    }
    const rules = [{ rule: slow, setting: activeRules(s, [rule('no-h1')])[0].setting }]
    expect(await fixFile(app, file, rules)).toBe('changed-underneath')
    expect(await app.vault.read(file)).toBe('typed meanwhile')
  })

  it('says a note with nothing to fix is unchanged, and writes nothing', async () => {
    const fake = vault({ 'n.md': GOOD })
    const app = fake as unknown as App
    fake.resetStats()
    const outcome = await fixFile(
      app,
      app.vault.getAbstractFileByPath('n.md') as never,
      activeRules(linterSettingsFrom({}), BUILTIN_RULES)
    )
    expect(outcome).toBe('unchanged')
    expect(fake.stats.modify).toBe(0)
  })
})

describe('rules from scripts', () => {
  const script = (name: string, lint: 'error' | 'warning' = 'warning'): ParsedScript => ({
    path: `Scripts/${name}.js`,
    meta: { name, description: 'Wants a summary line', params: [], lint },
    code: '',
    commandId: '',
  })

  it('checks and fixes with what the script gives back', async () => {
    const app = vault({ 'a.md': 'Body', 'b.md': 'Summary: yes\nBody' }) as unknown as App
    const loaded = await loadScriptRule(script('Summary'), async () => ({
      check: (note: { lines: string[] }) =>
        note.lines[0].startsWith('Summary:')
          ? []
          : ['No summary line', { message: 'second', line: 1, fixable: false }],
      fix: (note: { content: string }) => 'Summary: \n' + note.content,
    }))
    expect(loaded.id).toBe('script:Summary')
    const s = linterSettingsFrom({})
    const rules = activeRules(s, [loaded])
    const { issues } = await lintFiles(app, filesFor(app, { kind: 'vault' }, s), rules)
    expect(issues).toEqual([
      expect.objectContaining({
        path: 'a.md',
        rule: 'script:Summary',
        message: 'No summary line',
        line: 0,
        severity: 'warning',
        fixable: true,
      }),
      expect.objectContaining({ path: 'a.md', message: 'second', line: 1, fixable: false }),
    ])
    const file = app.vault.getAbstractFileByPath('a.md') as never
    expect(await fixFile(app, file, rules)).toBe('fixed')
    expect(await app.vault.read(file)).toBe('Summary: \nBody')
  })

  it('reports a script that throws once, and goes on with the other rules', async () => {
    const app = vault({ 'a.md': '# H', 'b.md': '# H' }) as unknown as App
    let calls = 0
    const broken = await loadScriptRule(script('Broken'), async () => ({
      check: () => {
        calls++
        throw new Error('boom')
      },
    }))
    const s = linterSettingsFrom({})
    const rules = [...only(s, 'no-h1'), ...activeRules(s, [broken])]
    const run = await lintFiles(app, filesFor(app, { kind: 'vault' }, s), rules, { batch: 1 })
    expect(run.ruleErrors).toEqual({ 'script:Broken': 'boom' })
    expect(calls).toBe(1)
    expect(run.issues.filter((i) => i.rule === 'no-h1')).toHaveLength(2)
  })

  it('reports a script that gives back no check', async () => {
    const loaded = await loadScriptRule(script('Empty'), async () => ({}))
    await expect(loaded.check({} as never, {})).rejects.toThrow(/no check/)
  })

  it('cannot change the note it is handed for the rules after it', async () => {
    const app = vault({ 'a.md': '---\ncreated: 2026-01-01\n---\n\nx' }) as unknown as App
    const meddling = await loadScriptRule(script('Meddle'), async () => ({
      check: (note: { frontmatter: Record<string, unknown> | null; lines: string[] }) => {
        if (note.frontmatter) delete note.frontmatter.created
        note.lines.length = 0
        return []
      },
    }))
    const s = linterSettingsFrom({})
    const rules = [...activeRules(s, [meddling]), ...only(s, 'required-properties')]
    const { issues } = await lintFiles(app, filesFor(app, { kind: 'vault' }, s), rules)
    expect(issues).toEqual([])
  })

  it('lists a script rule by its name and header before it is loaded', () => {
    const stub = scriptRuleStub(script('Summary', 'error'))
    expect(stub).toMatchObject({ id: 'script:Summary', title: 'Summary', severity: 'error' })
  })
})

describe('the settings', () => {
  it('start with each rule as it ships', () => {
    const rules = activeRules(linterSettingsFrom(undefined), BUILTIN_RULES).map((r) => r.rule.id)
    expect(rules).toContain('frontmatter-valid')
    expect(rules).not.toContain('no-tags')
  })

  it('keep what a rule was set to, and drop what makes no sense', () => {
    const s = linterSettingsFrom({
      exclude: ['Templates', 3],
      rules: {
        'no-tags': {
          enabled: true,
          severity: 'warning',
          folders: ['A'],
          params: { inline: false },
        },
        broken: 'x',
      },
    })
    expect(s.exclude).toEqual(['Templates'])
    expect(Object.keys(s.rules)).toEqual(['no-tags'])
    const [active] = activeRules(s, [rule('no-tags')])
    expect(active.setting).toMatchObject({ folders: ['A'], severity: 'warning' })
    expect(active.setting.params).toEqual({ inline: false })
  })

  it('fill a rule’s parameters it was never given with their defaults', () => {
    const s = withRuleSetting(linterSettingsFrom({}), rule('note-type'), { enabled: true })
    const [active] = activeRules(s, [rule('note-type')])
    expect(active.setting.params).toEqual({ property: 'type', allowed: [], default: '' })
  })
})

describe('a fix that would break the properties', () => {
  it('is not written', async () => {
    const fake = vault({ 'n.md': '---\na: 1\n---\n# Title\n' })
    const app = fake as unknown as App
    const s = linterSettingsFrom({})
    const file = app.vault.getAbstractFileByPath('n.md') as never
    const breaking: LintRule = {
      ...rule('no-h1'),
      id: 'breaking',
      fix: (note) => note.content.replace('a: 1', 'a: [1').replace('# Title', '## Title'),
    }
    const rules = [{ rule: breaking, setting: activeRules(s, [rule('no-h1')])[0].setting }]
    expect(await fixFile(app, file, rules)).toBe('unchanged')
    expect(await app.vault.read(file)).toBe('---\na: 1\n---\n# Title\n')
  })
})
