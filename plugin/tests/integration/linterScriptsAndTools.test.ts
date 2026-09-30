/**
 * The linter end to end without Obsidian: a `// @lint` script found by the script index and
 * turned into a rule, kept out of the commands and the agent's script tools, and the `lint` and
 * `lint_fix` tools an agent calls — bounded by the chat's scope.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptRuns } from '@/scripting/ScriptRuns'
import { parseScriptHeader } from '@/scripting/ScriptParser'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { LinterService } from '@/linter/LinterService'
import { linterSettingsFrom } from '@/linter/settings'
import { createLintTool, createLintFixTool } from '@/ai/tools/LintTools'
import { createScriptTools } from '@/ai/tools/ScriptTool'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const DECLARED = `// @name Has a summary
// @description The body opens with a Summary line
// @lint warning

function check(note) {
  return note.body.trimStart().startsWith('Summary:') ? [] : [{ message: 'No summary line', line: note.bodyStart }]
}

function fix(note) {
  return note.content.replace(/^(---\\n[\\s\\S]*?\\n---\\n)?/, (head) => (head || '') + 'Summary: \\n')
}
`

const RETURNED = `// @name No drafts
// @lint
return {
  check: (note) => (note.frontmatter?.draft ? ['Still a draft'] : []),
}
`

const WRITER = `// @name Sneaky
// @lint
await write('Private/planted.md', 'x')
function check(note) { return [] }
`

const WRITER_IN_CHECK = `// @name Sneaky check
// @lint
function check(note) {
  create('Private/also.md', 'x')
  return []
}
`

const RUNNABLE = `// @name Say hi
return 'hi'
`

let app: FakeApp
const plugin = {
  addCommand: vi.fn(),
  removeCommand: vi.fn(),
  addStatusBarItem: vi.fn(() => document.body.appendChild(document.createElement('div'))),
}

const text = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join('\n')

beforeEach(async () => {
  app = useVault([
    { path: 'Scripts/summary.js', raw: DECLARED },
    { path: 'Scripts/drafts.js', raw: RETURNED },
    { path: 'Scripts/hi.js', raw: RUNNABLE },
    { path: 'Scripts/sneaky.js', raw: WRITER },
    { path: 'Scripts/sneaky-check.js', raw: WRITER_IN_CHECK },
    { path: 'Notes/good.md', raw: '---\ncreated: 2026-01-01\n---\n\nSummary: ok\n' },
    { path: 'Notes/bare.md', raw: '# bare\ntext\n', frontmatter: undefined },
    {
      path: 'Private/draft.md',
      raw: '---\ncreated: 2026-01-01\ndraft: true\n---\n\nSummary: x\n',
      frontmatter: { created: '2026-01-01', draft: true },
    },
  ])
  ScriptRuns.destroy()
  ScriptService.destroy()
  LinterService.destroy()
  plugin.addCommand.mockClear()
  const config = AbeleConfig.getInstance()
  config.ai = { ...DEFAULT_AI_SETTINGS, scriptsEnabled: true, scriptsFolder: 'Scripts' }
  config.linter = linterSettingsFrom({})
  ;(config as unknown as { plugin: unknown }).plugin = plugin
  await ScriptService.getInstance().discover()
  ScopeResolver.getInstance().setFullVaultAccess(true)
})

describe('a lint script', () => {
  it('is read from its header, a warning when it says so', () => {
    expect(parseScriptHeader(DECLARED)?.lint).toBe('warning')
    expect(parseScriptHeader(RETURNED)?.lint).toBe('error')
    expect(parseScriptHeader(RUNNABLE)?.lint).toBeUndefined()
  })

  it('is neither a command nor a tool for the agent', () => {
    const commands = plugin.addCommand.mock.calls.map((c) => (c[0] as { name: string }).name)
    expect(commands).toEqual(['Script: Say hi'])
    expect(createScriptTools().map((t) => t.name)).toEqual(['script_say-hi'])
  })

  it('is listed with the built-in rules, and checks and fixes once loaded', async () => {
    const service = LinterService.getInstance()
    expect(service.allRules().map((r) => r.id)).toEqual(
      expect.arrayContaining(['script:Has a summary', 'script:No drafts', 'no-h1'])
    )
    const report = await service.run({ kind: 'folder', path: 'Notes' })
    const mine = report.issues.filter((i) => i.rule.startsWith('script:'))
    expect(mine).toEqual([
      expect.objectContaining({
        path: 'Notes/bare.md',
        rule: 'script:Has a summary',
        severity: 'warning',
        fixable: true,
        line: 1,
      }),
    ])
    expect(Object.keys(report.ruleErrors).sort()).toEqual(['script:Sneaky', 'script:Sneaky check'])

    await service.fix('Notes/bare.md', 'script:Has a summary')
    expect(app.vault.getFileByPath('Notes/bare.md')).not.toBeNull()
    expect(await app.vault.read(app.vault.getFileByPath('Notes/bare.md')!)).toBe(
      'Summary: \n# bare\ntext\n'
    )
    expect(service.report.value?.issues.some((i) => i.rule === 'script:Has a summary')).toBe(false)
  })

  it('may give back its rule instead of declaring it', async () => {
    const report = await LinterService.getInstance().run({ kind: 'vault' })
    expect(report.issues.filter((i) => i.rule === 'script:No drafts').map((i) => i.path)).toEqual([
      'Private/draft.md',
    ])
  })
})

describe('a lint script only reads', () => {
  it('cannot write while it is loaded nor while it checks, and says so', async () => {
    const report = await LinterService.getInstance().run({ kind: 'folder', path: 'Notes' })
    expect(report.ruleErrors['script:Sneaky']).toMatch(/only read/)
    expect(report.ruleErrors['script:Sneaky check']).toMatch(/only read/)
    expect(app.vault.getFileByPath('Private/planted.md')).toBeNull()
    expect(app.vault.getFileByPath('Private/also.md')).toBeNull()
  })

  it('still reads the vault', async () => {
    const ctx = ScriptService.getInstance()
    const def = (await ctx.definition('Scripts/drafts.js')) as { check: unknown }
    expect(typeof def.check).toBe('function')
  })
})

describe('the agent tools', () => {
  it('lint lists what the rules find, grouped by folder and note', async () => {
    const out = text(await createLintTool().execute('1', { path: 'Notes' }))
    expect(out).toMatch(/^Linted 2 notes with \d+ rules: \d+ issues in 1 notes, \d+ fixable\./)
    expect(out).toContain('Notes/ (1)')
    expect(out).toContain('  bare.md')
    expect(out).toMatch(/L1 no-h1 \(warning, fixable\): A first-level heading/)
  })

  it('lint keeps to one rule when asked', async () => {
    const out = text(await createLintTool().execute('1', { rule: 'script:No drafts' }))
    expect(out).toContain('1 issues in 1 notes')
    expect(out).not.toContain('no-h1')
  })

  it('lint and lint_fix see only the chat’s scope', async () => {
    const scope = ScopeResolver.getInstance()
    scope.setFullVaultAccess(false)
    scope.addFolder('Notes')
    const out = text(await createLintTool().execute('1', {}))
    expect(out).not.toContain('draft.md')
    await createLintFixTool().execute('2', { path: '/' })
    const draft = await app.vault.read(app.vault.getFileByPath('Private/draft.md')!)
    expect(draft).toContain('draft: true')
  })

  it('lint_fix fixes a note and says so — a title that repeats the name goes', async () => {
    const out = text(
      await createLintFixTool().execute('1', { path: 'Notes/bare.md', rule: 'no-h1' })
    )
    expect(out).toContain('Fixed 1 of 1 notes.')
    expect(await app.vault.read(app.vault.getFileByPath('Notes/bare.md')!)).toBe('text\n')
  })

  it('refuses a path that is neither a note nor a folder', async () => {
    await expect(createLintTool().execute('1', { path: 'Nowhere' })).rejects.toThrow(
      /No note or folder/
    )
  })
})

import { deferred } from '../helpers/deferred'

describe('the report on screen', () => {
  it('fixes with the rules its own run used, not a later or earlier run’s', async () => {
    const service = LinterService.getInstance()
    const config = AbeleConfig.getInstance()
    // A slow first run, overtaken by a second with no-h1 switched off: its rules arrive last.
    const load = service.loadRules.bind(service)
    const entered = deferred()
    const release = deferred()
    let first = true
    vi.spyOn(service, 'loadRules').mockImplementation(async (settings) => {
      const rules = await load(settings)
      if (first) {
        first = false
        entered.resolve()
        await release.promise
      }
      return rules
    })
    const slow = service.run({ kind: 'folder', path: 'Notes' })
    await entered.promise
    config.linter = linterSettingsFrom({ rules: { 'no-h1': { enabled: false } } })
    const fast = await service.run({ kind: 'folder', path: 'Notes' })
    release.resolve()
    await slow
    expect(service.report.value?.startedAt).toBe(fast.startedAt)
    await service.fix('Notes/bare.md')
    expect(await app.vault.read(app.vault.getFileByPath('Notes/bare.md')!)).toContain('# bare')
  })

  it('writes a previewed fix only over the text it was worked out from', async () => {
    const service = LinterService.getInstance()
    await service.run({ kind: 'folder', path: 'Notes' })
    const file = app.vault.getFileByPath('Notes/bare.md')!
    const shown = await service.preview('Notes/bare.md')
    await app.vault.modify(file, '# bare\nedited meanwhile\n')
    expect(await service.applyPreview('Notes/bare.md', shown!)).toBe('changed-underneath')
    expect(await app.vault.read(file)).toBe('# bare\nedited meanwhile\n')

    const again = await service.preview('Notes/bare.md')
    expect(await service.applyPreview('Notes/bare.md', again!)).toBe('fixed')
    expect(await app.vault.read(file)).toBe(again!.after)
  })

  it('finishes the run when a note cannot be read, and names the note', async () => {
    const service = LinterService.getInstance()
    const read = app.vault.cachedRead.bind(app.vault)
    app.vault.cachedRead = async (f) => {
      if (f.path === 'Notes/good.md') throw new Error('gone')
      return read(f)
    }
    const report = await service.run({ kind: 'folder', path: 'Notes' })
    expect(report.running).toBe(false)
    expect(service.report.value?.running).toBe(false)
    expect(report.checked).toBe(2)
    expect(report.issues).toContainEqual(
      expect.objectContaining({ path: 'Notes/good.md', rule: 'unreadable', fixable: false })
    )
    expect(report.issues.some((i) => i.path === 'Notes/bare.md')).toBe(true)
  })
})
