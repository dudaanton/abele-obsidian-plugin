import { afterEach, expect, it, vi } from 'vitest'
import { initializeLocale } from '../helpers/i18n'
import { collectEntries, buildPayload, applyEntries } from '@/transfer/entries'
import { statusLabel, statusTooltip, DISCONNECTED_STATUS } from '@/sync/status'
import type { AbeleSettings } from '@/services/AbeleConfig'
import { catalogs, validateCatalogs } from '@/i18n/catalogs'
import { streamC } from '@/i18n/locales/en/streamC'
import ledger from '@/i18n/streamC-ledger.json'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { extract } from '../../scripts/i18n-manifest.mjs'
import { setTestLocale } from '@/testing/i18nLocale'
import { t } from '@/i18n'
import { formatWhen } from '@/sync/format'
import { extra } from '@/i18n/locales/en/streamCExtra'
import extraLedger from '@/i18n/streamC-extra-ledger.json'
import { frameOps } from '@/canvas/input'
import { PROGRESS_SHOWS, progressText } from '@/reader/readingProgress'
import { COLOUR_NAMES, COLOURS, SLOTS, SWATCH_COLOURS } from '@/components/canvas/chromeTools'
import { wholeValue, detectFormat } from '@/components/debugger/valueFormat'
import { lintHeadline, lintScope } from '@/i18n/streamCLinter'
import { reportHeadline } from '@/linter/grouping'
import type { LintReport, LintTarget } from '@/linter/types'
import policy from '@/i18n/streamC-migrated.json'
import { parse, compileTemplate } from '@vue/compiler-sfc'
import { PresenterView } from '@/slides/core/PresenterView'
import { Presentation } from '@/slides/core/Presentation'
import { parseDeck } from '@/slides/core/markdown'
import { cards, setup } from '../helpers/canvasEditorHarness'
import { streamCUI } from '@/i18n/streamCLabels'
import { saveRunNote, notesFolderFailureText } from '@/debugger/trace/notesFolder'

afterEach(() => {
  initializeLocale('en')
  vi.useRealTimers()
})

it('keeps trace-note exceptions stable for agent callers in every language', async () => {
  const path = '/sample-outside'
  for (const adapter of [
    {},
    { fsPromises: { stat: async () => ({ isDirectory: () => false }) } },
  ]) {
    const app = { vault: { adapter } } as unknown as Parameters<typeof saveRunNote>[0]
    const failure = async () => {
      try {
        await saveRunNote(app, path, 'sample', 'Original content')
      } catch (error) {
        if (error instanceof Error) return error
        throw error
      }
      throw new Error('Expected the synthetic adapter to refuse the write')
    }
    initializeLocale('en')
    const original = (await failure()).message
    for (const language of ['en', 'ru', 'lv', 'es', 'de']) {
      initializeLocale(language)
      const error = await failure()
      expect(error.message).toBe(original)
      expect(JSON.stringify(error)).toBe('{}')
      const label = notesFolderFailureText(error)
      expect(label).toContain(path)
      if (language === 'en') expect(label).toBe(original)
      else expect(label).not.toBe(original)
    }
  }
})

it('translates native slide controls while keeping slide and speaker content original', async () => {
  initializeLocale('ru')
  const deck = parseDeck('# Original title\n\n> [!notes]\n> Original speaker note\n---\n# Second')
  const original = JSON.stringify(deck)
  const show = new Presentation(2)
  const host = document.createElement('div')
  document.body.append(host)
  const view = new PresenterView(
    host,
    show,
    {
      render: async (block, target) => {
        target.textContent = block.source
        return () => {}
      },
    },
    { resolve: () => null, readCss: async () => '' }
  )
  try {
    await view.setDeck(deck)
    expect(view.root.querySelector('button')?.textContent).toBe('Предыдущий')
    expect(view.current.root.querySelector('[aria-label="Предыдущий слайд"]')).not.toBeNull()
    expect(view.notes.textContent).toBe('Original speaker note')
    expect(view.root.querySelector('select option')?.textContent).toBe('1. Original title')
    expect(JSON.stringify(deck)).toBe(original)
  } finally {
    show.end()
    view.destroy()
    host.remove()
  }
})

it('keeps Canvas control identifiers working behind localized labels', () => {
  initializeLocale('ru')
  const s = setup(cards())
  const original = JSON.stringify(s.document.session.graph)
  const label = streamCUI('Draw with marker')
  expect(label).not.toBe('Draw with marker')
  expect(
    [...s.el.querySelectorAll('button')].some(
      (button) => button.getAttribute('aria-label') === label
    )
  ).toBe(true)
  s.editor.controls.press('Draw with marker')
  expect(s.editor.controls.tool()).toBe('marker')
  s.editor.controls.set('ink-color', '2')
  expect(s.editor.controls.value('ink-color')).toBe('2')
  expect(JSON.stringify(s.document.session.graph)).toBe(original)
})

it('localizes linter projections without changing reports or English output', () => {
  expect(lintHeadline(null)).toBe(reportHeadline(null))
  const targets: LintTarget[] = [
    { kind: 'vault' },
    { kind: 'folder', path: 'Sample folder' },
    { kind: 'notes', paths: ['Sample.md'] },
    { kind: 'notes', paths: ['One.md', 'Two.md'] },
  ]
  for (const target of targets) {
    initializeLocale('en')
    const report: LintReport = {
      target,
      scope: '',
      issues: [],
      checked: 1,
      total: 2,
      running: false,
      cancelled: false,
      ruleErrors: { sample: 'E_SAMPLE raw diagnostic' },
      startedAt: 1,
      finishedAt: 2,
    }
    report.scope = lintScope(report)
    for (const running of [true, false]) {
      for (const cancelled of [true, false]) {
        for (const found of [true, false]) {
          initializeLocale('en')
          Object.assign(report, {
            running,
            cancelled,
            issues: found
              ? [
                  {
                    path: 'Sample.md',
                    rule: 'sample',
                    message: 'Original diagnostic',
                    line: 1,
                    severity: 'warning',
                    fixable: true,
                  },
                ]
              : [],
          })
          expect(lintHeadline(report)).toBe(reportHeadline(report))
          const original = JSON.stringify(report)
          for (const language of ['ru', 'lv', 'es', 'de']) {
            initializeLocale(language)
            expect(lintHeadline(report)).not.toBe(reportHeadline(report))
            expect(JSON.stringify(report)).toBe(original)
          }
        }
      }
    }
  }
})

it('guards every stream C surface and compiles all migrated Vue templates', () => {
  const remaining = []
  for (const path of policy.files) {
    const source = readFileSync(`src/${path}`, 'utf8')
    remaining.push(
      ...extract(path, source).filter(
        (entry) =>
          !policy.exceptions.some(
            (exception) => exception.path === entry.path && exception.text === entry.text
          )
      )
    )
    if (!path.endsWith('.vue')) continue
    const parsed = parse(source, { filename: path })
    expect(parsed.errors, path).toEqual([])
    if (parsed.descriptor.template) {
      const compiled = compileTemplate({
        source: parsed.descriptor.template.content,
        filename: path,
        id: path,
        compilerOptions: { expressionPlugins: ['typescript'] },
      })
      expect(compiled.errors, path).toEqual([])
    }
  }
  expect(remaining).toEqual([])
})

it('localizes sync status without translating diagnostic details or changing state', () => {
  const status = {
    ...DISCONNECTED_STATUS,
    state: 'error' as const,
    lastError: 'E_SAMPLE raw detail',
  }
  const before = JSON.stringify(status)
  initializeLocale('ru')
  expect(statusLabel(status)).toBe('Ошибка синхронизации')
  expect(statusTooltip(status)).toContain('E_SAMPLE raw detail')
  expect(JSON.stringify(status)).toBe(before)
})

it('keeps transfer bytes and applied sync settings identical in every language', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2025-01-02T03:04:05Z'))
  const settings = {
    ai: {},
    sync: { keySignature: { property: 'sample-key', value: 'Original content' } },
    tasksFolder: 'Sample tasks',
  } as AbeleSettings
  const bytes = () => JSON.stringify(buildPayload(collectEntries(settings), null))
  initializeLocale('en')
  const original = bytes()
  const applied = JSON.stringify(
    applyEntries(collectEntries(settings), { ai: {} } as AbeleSettings)
  )
  for (const language of ['ru', 'lv', 'es', 'de']) {
    initializeLocale(language)
    expect(bytes()).toBe(original)
    expect(
      JSON.stringify(applyEntries(collectEntries(settings), { ai: {} } as AbeleSettings))
    ).toBe(applied)
  }
})

it('has complete reviewed catalogs and guards the migrated surfaces', () => {
  expect(validateCatalogs(catalogs)).toEqual([])
  expect(
    Object.fromEntries(
      Object.entries(streamC).map(([key, value]) => [
        key,
        createHash('sha256').update(JSON.stringify(value)).digest('hex'),
      ])
    )
  ).toEqual(
    Object.fromEntries(Object.entries(ledger).map(([key, value]) => [key, value.englishHash]))
  )
  expect(
    Object.fromEntries(
      Object.entries(extra).map(([key, value]) => [
        key,
        createHash('sha256').update(JSON.stringify(value)).digest('hex'),
      ])
    )
  ).toEqual(
    Object.fromEntries(Object.entries(extraLedger).map(([key, value]) => [key, value.englishHash]))
  )
  for (const path of [
    'sync/status.ts',
    'components/sync/HeldDeletesModal.vue',
    'components/sync/SettingsArrivedModal.vue',
    'components/sync/TokenQrReader.vue',
  ])
    expect(extract(path, readFileSync(`src/${path}`, 'utf8'))).toEqual([])
})

it('keeps Canvas content, reader modes and debug values original while labels follow the locale', () => {
  const originalSwatches = JSON.stringify(SWATCH_COLOURS)
  const originalColors = JSON.stringify(COLOURS)
  const raw = '<sample attr="Original value">unchanged</sample>'
  for (const language of ['en', 'ru', 'lv', 'es', 'de']) {
    initializeLocale(language)
    const ops = frameOps({ nodes: [], edges: [] }, { x: 0, y: 0, width: 100, height: 100 })
    expect(ops[0]).toMatchObject({ op: 'add_node', node: { label: 'Frame' } })
    expect(PROGRESS_SHOWS).toEqual(['page', 'left', 'location', 'percent'])
    expect(JSON.stringify(SWATCH_COLOURS)).toBe(originalSwatches)
    expect(JSON.stringify(COLOURS)).toBe(originalColors)
    expect(SLOTS[0][0].members[0].id).toBe('select')
    expect(SLOTS[0][0].members[0].action).toBe('Select canvas objects')
    expect(wholeValue(raw, raw)).toBe(raw)
    expect(detectFormat(raw)).toBe('xml')
  }
  initializeLocale('ru')
  expect(COLOUR_NAMES['1']).toBe('красный')
  expect(SLOTS[0][0].members[0].label).toBe('Выбрать объекты холста')
  expect(progressText('page', { page: 2, pages: 5, location: 1, locations: 5 }, '20%')).toBe(
    'Страница 2 из 5'
  )
})

it('uses plural rules for sync counts and leaves interpolated diagnostics unchanged in pseudo mode', async () => {
  initializeLocale('ru')
  expect(t('sync.status.conflicts', { count: 1 })).toBe('1 конфликт')
  expect(t('sync.status.conflicts', { count: 2 })).toBe('2 конфликта')
  expect(t('sync.status.conflicts', { count: 5 })).toBe('5 конфликтов')
  expect(t('sync.status.conflicts', { count: 21 })).toBe('21 конфликт')
  await setTestLocale('en-XA')
  const raw = 'E_SAMPLE /sample/path.md'
  expect(t('sync.status.title', { status: raw })).toContain(raw)
  expect(statusTooltip({ ...DISCONNECTED_STATUS, lastError: raw })).toContain(raw)
})

it('formats sync times with the active locale and retains the English baseline', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2025-01-02T03:04:05Z'))
  expect(formatWhen(null)).toBe('never')
  expect(formatWhen('invalid')).toBe('never')
  expect(formatWhen('2025-01-02T03:02:05Z')).toBe('2 minutes ago')
  for (const language of ['ru', 'lv', 'es', 'de']) {
    initializeLocale(language)
    expect(formatWhen('2025-01-02T03:02:05Z')).toBe(
      new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(-2, 'minute')
    )
  }
})
