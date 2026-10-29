import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import I18nText from '../../src/components/obsidian/I18nText.vue'
import { checkMigrated, extract } from '../../scripts/i18n-manifest.mjs'
import policy from '../../src/i18n/migrated.json'
import { catalogs, validateCatalogs } from '../../src/i18n/catalogs'
import { initializeLocale } from '../helpers/i18n'
import { settingsOptions, settingsToolLabel, transferLabel } from '../../src/i18n/settingsLabels'
import { settingsCount } from '../../src/i18n/settingsCounts'
import { createTranslator } from '../../src/i18n/core'
import { settingsSyncText, settingsSyncWhen } from '../../src/i18n/settingsSync'
import { transferText } from '../../src/sync/transferProgress'
import { getSectionToolRegistry, getToolRegistry } from '../../src/ai/tools'
import { TOOL_SECTIONS, sectionLabel, sectionSummary } from '../../src/ai/toolSections'
import { isMcpToolName } from '../../src/ai/mcp/names'
import { createForgeTools } from '../../src/ai/tools/github'
import { BUILTIN_RULES } from '../../src/linter/rules'

const root = resolve('src')
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? files(path) : /\.(ts|vue)$/.test(path) ? [path] : []
  })
}

describe('complete settings migration', () => {
  it('translates the record point list tool in every locale', () => {
    try {
      for (const [locale, label] of Object.entries({
        en: 'Record points',
        ru: 'Точки записи',
        lv: 'Ieraksta punkti',
        es: 'Puntos de registro',
        de: 'Aufzeichnungspunkte',
      })) {
        initializeLocale(locale)
        expect(settingsToolLabel({ name: 'trace_point_list', label: 'Record points' })).toBe(label)
      }
    } finally {
      initializeLocale('en')
    }
  })
  it('keeps record point removal metadata stable and translates its settings label in every locale', () => {
    try {
      for (const [locale, label] of Object.entries({
        en: 'Remove record point',
        ru: 'Удалить точку записи',
        lv: 'Dzēst ieraksta punktu',
        es: 'Eliminar punto de registro',
        de: 'Aufzeichnungspunkt entfernen',
      })) {
        initializeLocale(locale)
        const tool = getToolRegistry().find((entry) => entry.name === 'trace_point_remove')!
        expect(tool.label).toBe('Remove record point')
        expect(settingsToolLabel(tool)).toBe(label)
      }
    } finally {
      initializeLocale('en')
    }
  })

  it('retains literal property-template tokens and date formats in translated help', () => {
    const missing: string[] = []
    for (const [key, message] of Object.entries(catalogs.en)) {
      if (typeof message !== 'string') continue
      const tokens = message.match(/\{\{[^}]+\}\}|\bYYYY-MM-DD\b/g) ?? []
      if (!tokens.length) continue
      for (const locale of ['ru', 'lv', 'es', 'de']) {
        const translated = createTranslator(locale, catalogs)(key)
        for (const token of tokens)
          if (!translated.includes(token)) missing.push(`${locale}/${key}: ${token}`)
      }
    }
    expect(missing).toEqual([])
  })
  it('covers every built-in tool and section display label in the catalogs', () => {
    const labels = new Set(
      Object.entries(catalogs.en)
        .filter(([key]) => key.startsWith('settings.metadata.'))
        .map(([, value]) => value)
    )
    const missing: string[] = []
    for (const tool of [...getToolRegistry(), ...getToolRegistry(createForgeTools())]) {
      // Server and script names are user/provider data, rather than plugin-owned labels.
      if (
        isMcpToolName(tool.name) ||
        (tool.name.startsWith('script_') && tool.name !== 'script_api_docs')
      )
        continue
      if (!labels.has(tool.label)) missing.push(tool.label)
      if (!labels.has(tool.category)) missing.push(tool.category)
    }
    for (const section of TOOL_SECTIONS) {
      if (!labels.has(section.group)) missing.push(section.group)
      if (!labels.has(sectionLabel(section.group))) missing.push(sectionLabel(section.group))
      if (section.summary && !labels.has(sectionSummary(section.group)))
        missing.push(sectionSummary(section.group))
    }
    for (const rule of BUILTIN_RULES) {
      for (const text of [
        rule.title,
        rule.description,
        ...rule.params.flatMap((param) => [param.label, param.description]),
      ])
        if (text && !labels.has(text)) missing.push(text)
    }
    expect([...new Set(missing)]).toEqual([])
    for (const tool of getSectionToolRegistry()) expect(settingsToolLabel(tool)).toBe(tool.label)
  })
  it('translates indirect sync progress through a presentation port without changing snapshots', () => {
    const snapshot = { stage: 'Downloading', completed: 2, total: 5, totalKnown: true }
    expect(transferText(snapshot)).toBe('Downloading · 2 of 5 files')
    try {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-01-01T12:02:00Z'))
      initializeLocale('ru')
      expect(transferText(snapshot, settingsSyncText)).toBe('Загрузка · 2 из 5 файлов')
      expect(
        settingsSyncText('{count} files not sent', { count: 21 }, '{count} file not sent')
      ).toBe('21 файл не отправлен')
      expect(snapshot).toEqual({ stage: 'Downloading', completed: 2, total: 5, totalKnown: true })
      expect(settingsSyncText('sample diagnostic {code}', { code: 'sample-code' })).toBe(
        'sample diagnostic sample-code'
      )
      expect(settingsSyncWhen('2025-01-01T12:00:00Z')).toBe('2 минуты назад')
    } finally {
      initializeLocale('en')
      vi.useRealTimers()
    }
  })
  it('keeps the generated MCP tool-name syntax and slug intact in explanatory text', () => {
    const translate = createTranslator('en', catalogs)
    expect(
      translate('settings.ai.McpServerModal.also_the_start_of_its.6f23c597', {
        value0: 'sample_server',
      })
    ).toBe("Also the start of its tools' names: mcp_sample_server_<tool>.")
  })
  it('inflects cached people and transfer code counts while keeping their English sentences', () => {
    const english = createTranslator('en', catalogs)
    const russian = createTranslator('ru', catalogs)
    const key = 'settings.GithubSettings.value_value_kept_on_this.ceefdd92'
    expect(english(key, { count: 1 })).toMatch(/^1 person is kept on this device\./)
    expect(english(key, { count: 21 })).toMatch(/^21 people are kept on this device\./)
    expect([1, 2, 5, 21].map((count) => russian(key, { count }).split('.')[0])).toEqual([
      'На этом устройстве сохранён 1 пользователь',
      'На этом устройстве сохранены 2 пользователя',
      'На этом устройстве сохранено 5 пользователей',
      'На этом устройстве сохранён 21 пользователь',
    ])
    expect(
      english('settings.transfer.TransferSendModal.value_codes_shown_one_after.2e23aff2', {
        count: 2,
        value1: '',
      })
    ).toBe('2 codes, shown one after another — or copy the text and skip the camera.')
  })
  it('guards shared control labels supplied by settings callers', () => {
    expect(
      extract(
        'sample.vue',
        `<template><SecretField replace-placeholder="New key" save-tooltip="Save this key" what="The key" /><EntryRow more-label="What goes" confirm-tooltip="Remove this entry" /><Dropdown :options="[{ value: 'stable-id', display: 'None' }]" /></template>`
      ).map((entry) => entry.text)
    ).toEqual(['New key', 'Save this key', 'The key', 'What goes', 'Remove this entry', 'None'])
  })
  it('localizes display metadata and plurals without changing transfer entries or option IDs', () => {
    const custom = { id: 'sample-custom', section: 'tasks', label: 'Tasks' }
    const block = { id: 'tasks', section: 'tasks', label: 'Tasks' }
    try {
      initializeLocale('ru')
      expect(settingsToolLabel({ name: 'mcp_sample_read', label: 'Read file' })).toBe('Read file')
      expect(settingsToolLabel({ name: 'script_sample', label: 'Read file' })).toBe('Read file')
      expect(transferLabel(custom)).toBe('Tasks')
      expect(transferLabel({ id: 'ai-agents', section: 'ai-agents', label: 'Agents' })).toBe(
        'Agents'
      )
      expect(transferLabel(block)).toBe('Задачи')
      expect(custom).toEqual({ id: 'sample-custom', section: 'tasks', label: 'Tasks' })
      const options = [{ value: 'message', display: 'Your messages' }]
      expect(settingsOptions(options)).toEqual([{ value: 'message', display: 'Ваши сообщения' }])
      expect(options).toEqual([{ value: 'message', display: 'Your messages' }])
      expect([1, 2, 5, 21].map((count) => settingsCount('key', count))).toEqual([
        '1 ключ',
        '2 ключа',
        '5 ключей',
        '21 ключ',
      ])
    } finally {
      initializeLocale('en')
    }
  })
  it('keeps inline code as slots when a translated sentence reorders them', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const view = mount(I18nText, {
      attachTo: host,
      props: { text: 'After ⟪second⟫, before ⟪first⟫.' },
      slots: { first: '<code>sample_one</code>', second: '<code>sample_two</code>' },
    })
    // Fragment-wrapper text() trims every root separately; check the actual rendered sentence.
    expect(host.textContent).toBe('After sample_two, before sample_one.')
    expect(view.findAll('code').map((code) => code.text())).toEqual(['sample_two', 'sample_one'])
    view.unmount()
    host.remove()
  })
  it('guards every settings file and preserves valid Vue setup macros', () => {
    for (const path of [
      'components/AiScopeEditor.vue',
      'components/ToolModesEditor.vue',
      'helpers/suggesters/ScopeSuggest.ts',
      'components/reader/ReaderSettingsForm.vue',
      'components/reader/BookNotesSettings.vue',
      'components/reader/BookScriptsSettings.vue',
    ])
      expect(policy.files, path).toContain(path)
    for (const path of files(join(root, 'components/settings'))) {
      expect(policy.files, relative(root, path)).toContain(relative(root, path))
      if (path.endsWith('.vue')) {
        const { descriptor, errors } = parse(readFileSync(path, 'utf8'))
        expect(errors, path).toEqual([])
        if (descriptor.scriptSetup)
          expect(() => compileScript(descriptor, { id: path })).not.toThrow()
      }
    }
    expect(checkMigrated()).toEqual([])
    expect(validateCatalogs(catalogs)).toEqual([])
  })

  it('keeps generated content and saved defaults independent of language', () => {
    const source = (name: string) => readFileSync(join(root, 'components/settings', name), 'utf8')
    expect(source('ai/AgentsSettings.vue')).toContain(
      'name: `Agent ${registry.list({ includeUtility: true }).length + 1}`'
    )
    expect(source('transfer/TransferSendModal.vue')).toContain("const name = ref('Other device')")
    expect(source('transfer/TransferSendModal.vue')).toContain('`Abele transfer ${stamp()}.txt`')
    expect(source('ai/ToolDescriptions.vue')).toContain('tool.description')
    expect(source('ai/ToolDescriptions.vue')).toContain(
      "emit('update', tool.name, own ? '' : draft.value)"
    )
  })
})
