/**
 * The linter's tab: what reaches the screen for a report — the headline, groups by note and by
 * rule, folded and paged when there are many — and what its controls ask the service to do.
 * Where the lines land on screen is for the e2e tier (`tests/e2e/linter.e2e.test.ts`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import LinterPanel from '@/components/linter/LinterPanel.vue'
import { LinterService } from '@/linter/LinterService'
import { groupIssues, reportHeadline } from '@/linter/grouping'
import type { LintIssue, LintReport } from '@/linter/types'
import { useVault } from '../helpers/testEnv'

const openIssue = vi.fn()
vi.mock('@/linter/openIssue', () => ({ openIssue: (...a: unknown[]) => openIssue(...a) }))

function issue(path: string, rule: string, line = 3, over: Partial<LintIssue> = {}): LintIssue {
  return {
    path,
    rule,
    line,
    message: `${rule} in ${path}`,
    severity: 'error',
    fixable: true,
    ...over,
  }
}

function report(issues: LintIssue[], over: Partial<LintReport> = {}): LintReport {
  return {
    scope: 'the whole vault',
    target: { kind: 'vault' },
    issues,
    checked: 10,
    total: 10,
    running: false,
    cancelled: false,
    ruleErrors: {},
    startedAt: Date.now() + Math.random(),
    finishedAt: Date.now(),
    ...over,
  }
}

let wrapper: VueWrapper | null = null
const service = LinterService.getInstance()

function show(r: LintReport | null) {
  service.report.value = r
  wrapper = mount(LinterPanel, {
    global: {
      stubs: {
        ConfirmModal: {
          props: ['title', 'message'],
          emits: ['confirm', 'close'],
          template:
            '<div class="stub-confirm">{{ message }}<i class="yes" @click="$emit(\'confirm\')" /></div>',
        },
        ObsidianModal: { template: '<div class="stub-modal"><slot /><slot name="footer" /></div>' },
        Diff: { props: ['textLeft', 'textRight'], template: '<div class="stub-diff" />' },
      },
    },
  })
  return wrapper
}

beforeEach(() => {
  useVault([])
  openIssue.mockReset()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  service.report.value = null
  vi.restoreAllMocks()
})

describe('the headline', () => {
  it('says what was linted and what came of it', () => {
    expect(reportHeadline(null)).toBe('Nothing linted yet.')
    expect(reportHeadline(report([]))).toBe('Linted the whole vault: 10 notes, nothing found.')
    expect(
      reportHeadline(
        report([issue('a.md', 'no-h1'), issue('b.md', 'no-h1', 1, { fixable: false })])
      )
    ).toBe('Linted the whole vault: 10 notes. 2 issues in 2 notes, 1 can be fixed.')
    expect(reportHeadline(report([], { running: true, checked: 40, total: 1200 }))).toBe(
      'Linting the whole vault: 40 of 1,200 notes.'
    )
  })
})

describe('grouping', () => {
  it('puts notes by path and rules with the most errors first', () => {
    const issues = [
      issue('b.md', 'no-h1'),
      issue('a.md', 'no-h1', 9),
      issue('a.md', 'no-tags', 2, { severity: 'warning' }),
      issue('a.md', 'no-h1', 4),
    ]
    expect(groupIssues(issues, 'note').map((g) => [g.key, g.issues.map((i) => i.line)])).toEqual([
      ['a.md', [2, 4, 9]],
      ['b.md', [3]],
    ])
    expect(groupIssues(issues, 'rule').map((g) => [g.key, g.errors])).toEqual([
      ['no-h1', 3],
      ['no-tags', 0],
    ])
  })
})

describe('the linter tab', () => {
  it('asks to lint when nothing has been', () => {
    const w = show(null)
    expect(w.find('[data-testid="linter-headline"]').text()).toBe('Nothing linted yet.')
    expect(w.text()).toContain('Lint vault')
  })

  it('lists each note with its issues, open, and by rule on asking', async () => {
    const w = show(
      report([issue('A/one.md', 'no-h1'), issue('A/one.md', 'no-tags'), issue('two.md', 'no-h1')])
    )
    expect(w.findAll('.abele-linter__group').map((g) => g.attributes('data-group'))).toEqual([
      'A/one.md',
      'two.md',
    ])
    expect(w.findAll('.abele-linter__issue')).toHaveLength(3)

    await w.findAll('.abele-tabs__tab')[1].trigger('click')
    expect(w.findAll('.abele-linter__group').map((g) => g.attributes('data-group'))).toEqual([
      'no-h1',
      'no-tags',
    ])
  })

  it('folds many groups and shows them fifty at a time', async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      issue(`n${String(i).padStart(2, '0')}.md`, 'no-h1')
    )
    const w = show(report(many))
    expect(w.findAll('.abele-linter__group')).toHaveLength(50)
    expect(w.findAll('.abele-linter__issue')).toHaveLength(0)
    const more = w.findAll('.abele-linter__more').find((b) => b.text().includes('more of 60'))!
    await more.trigger('click')
    expect(w.findAll('.abele-linter__group')).toHaveLength(60)

    await w.find('.abele-fold-heading').trigger('click')
    expect(w.findAll('.abele-linter__issue')).toHaveLength(1)
  })

  it('opens the note at the line of an issue pressed', async () => {
    const w = show(report([issue('A/one.md', 'no-h1', 7)]))
    await w.find('.abele-linter__issue').trigger('click')
    expect(openIssue).toHaveBeenCalledWith(expect.anything(), 'A/one.md', 7)
  })

  it('fixes one issue by its own rule', async () => {
    const fix = vi.spyOn(service, 'fix').mockResolvedValue('fixed')
    const w = show(report([issue('A/one.md', 'no-h1', 7)]))
    await w.find('.abele-linter__fix').trigger('click')
    expect(fix).toHaveBeenCalledWith('A/one.md', 'no-h1')
    expect(openIssue).not.toHaveBeenCalled()
  })

  it('asks before fixing everything, saying how much that is', async () => {
    const fixAll = vi
      .spyOn(service, 'fixAll')
      .mockResolvedValue({ fixed: 2, unchanged: 0, skipped: 0 })
    const w = show(
      report([
        issue('a.md', 'no-h1'),
        issue('a.md', 'no-tags'),
        issue('b.md', 'no-h1'),
        issue('c.md', 'x', 1, { fixable: false }),
      ])
    )
    const button = w.findAll('button').find((b) => b.text() === 'Fix all')!
    await button.trigger('click')
    const confirm = w.find('.stub-confirm')
    expect(confirm.text()).toContain('Fix 3 issues in 2 notes')
    expect(fixAll).not.toHaveBeenCalled()
    await confirm.find('.yes').trigger('click')
    expect(fixAll).toHaveBeenCalled()
  })

  it('shows what a note’s fix would change before writing it', async () => {
    vi.spyOn(service, 'preview').mockResolvedValue({ before: '# A', after: '## A' })
    const apply = vi.spyOn(service, 'applyPreview').mockResolvedValue('fixed')
    const w = show(report([issue('a.md', 'no-h1')]))
    const icons = w.findAll('.abele-linter__group-actions > *')
    await icons[1].trigger('click')
    await flushPromises()
    expect(w.find('.stub-diff').exists()).toBe(true)
    await w
      .findAll('.stub-modal button')
      .find((b) => b.text() === 'Fix')!
      .trigger('click')
    await flushPromises()
    expect(apply).toHaveBeenCalledWith(
      'a.md',
      expect.objectContaining({ before: '# A', after: '## A' })
    )
  })

  it('offers to stop a run going on, and names a rule that failed', () => {
    const cancel = vi.spyOn(service, 'cancel')
    const w = show(report([], { running: true, ruleErrors: { 'script:Mine': 'boom' } }))
    const stop = w.findAll('button').find((b) => b.text() === 'Stop')!
    void stop.trigger('click')
    expect(cancel).toHaveBeenCalled()
    expect(w.text()).toContain('failed and was skipped: boom')
  })
})
