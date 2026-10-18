import { catalogs as testCatalogs } from '@/i18n/catalogs'
import { afterEach, expect, it } from 'vitest'
import { initializeLocale, setTestTranslator } from '@/i18n'
import { createTranslator } from '@/i18n/core'
import { english } from '@/i18n/catalogs'
import { pseudoMessage } from '@/i18n/pseudo'
import { streamBLabel, streamBAgentDescription } from '@/i18n/streamBLabels'
import { keyLabel, stopTooltip } from '@/ai/chatTabKeyMap'
import { readFileSync } from 'node:fs'

afterEach(() => initializeLocale('en', testCatalogs['en' as keyof typeof testCatalogs]))

it('translates built-in agent descriptions and coverage labels without changing custom text', () => {
  const defaults = [
    'Migrated from the global AI settings.',
    'Migrated from interceptors.',
    'Answers comment chats anchored in a note.',
  ]
  for (const locale of ['ru', 'lv', 'es', 'de', 'en-XA']) {
    initializeLocale(locale, testCatalogs[locale as keyof typeof testCatalogs])
    if (locale === 'en-XA')
      setTestTranslator(
        createTranslator('en', {
          en: Object.fromEntries(
            Object.entries(english).map(([key, value]) => [
              key,
              typeof value === 'string'
                ? pseudoMessage(value)
                : Object.fromEntries(
                    Object.entries(value).map(([form, text]) => [form, pseudoMessage(text)])
                  ),
            ])
          ),
        })
      )
    const offline = {
      ru: 'Не в сети',
      lv: 'Bezsaistē',
      es: 'Desconectado',
      de: 'Offline',
      'en-XA': pseudoMessage('Offline'),
    }
    expect(streamBLabel('Offline')).toBe(offline[locale as keyof typeof offline])
    for (const text of defaults) {
      expect(streamBAgentDescription(text)).not.toBe(text)
    }
    expect(streamBAgentDescription('A custom agent description')).toBe('A custom agent description')
  }
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  expect(streamBLabel('Offline')).toBe('Не в сети')
  initializeLocale('en', testCatalogs['en' as keyof typeof testCatalogs])
  for (const text of defaults) expect(streamBAgentDescription(text)).toBe(text)
})

it('renders coverage and agent descriptions through the presentation layer', () => {
  expect(readFileSync('src/components/settings/ai/AgentsSettings.vue', 'utf8')).toContain(
    ':description="streamBAgentDescription(agent.description)"'
  )
  expect(readFileSync('src/agents/NodeAttentionWatch.ts', 'utf8')).toContain(
    'streamBLabel(TEXT[entry.state])'
  )
})

it('localizes shortcut hints while retaining physical key bindings', () => {
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  expect(keyLabel({ modifiers: ['Ctrl'], key: 'ArrowLeft' }, false)).toBe('Ctrl+Влево')
  expect(stopTooltip(false)).toBe('Стоп (Ctrl+C)')
  initializeLocale('en', testCatalogs['en' as keyof typeof testCatalogs])
  expect(stopTooltip(false)).toBe('Stop (Ctrl+C)')
})

it('localizes the built-in empty chat subtitle at display time', () => {
  expect(readFileSync('src/components/AiChat.vue', 'utf8')).toContain(
    "streamBAgentDescription(session?.agent.value?.description || '')"
  )
})

it('leaves custom descriptions intact even when they match a translated status label', () => {
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  for (const text of ['open', 'Offline', 'Current files', 'Contents']) {
    expect(streamBAgentDescription(text)).toBe(text)
  }
})
