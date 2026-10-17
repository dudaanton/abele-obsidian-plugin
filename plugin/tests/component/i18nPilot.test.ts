import { afterEach, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Waveform from '@/components/obsidian/Waveform.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import { initializeLocale } from '../helpers/i18n'
import { initializeLocale as initializeLoadedLocale } from '@/i18n'
import { loadCatalog } from '@/i18n/loader'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import { setTestLocale } from '@/testing/i18nLocale'

afterEach(() => initializeLocale('en'))

it('shows non-English UI after the requested catalog loads', async () => {
  const payload = JSON.stringify({
    version: '1.0.0',
    language: 'ru',
    catalog: { 'kit.waveform': 'Звуковая волна' },
  })
  const catalog = await loadCatalog({
    version: '1.0.0',
    language: 'ru',
    directory: 'plugin',
    hash: bytesToHex(sha256(new TextEncoder().encode(payload))),
    request: async () => payload,
    storage: {
      exists: async () => false,
      read: async () => '',
      write: async () => {},
      mkdir: async () => {},
      list: async () => ({ files: [] }),
      remove: async () => {},
    },
  })
  initializeLoadedLocale('ru', catalog)
  const waveform = mount(Waveform, { props: { levels: [] } })
  expect(waveform.attributes('aria-label')).toBe('Звуковая волна')
  waveform.unmount()
})

it('resolves hoisted kit defaults at mount after locale initialization', () => {
  initializeLocale('ru')
  const waveform = mount(Waveform, { props: { levels: [] } })
  expect(waveform.attributes('aria-label')).toBe('Звуковая волна')
  waveform.unmount()
  initializeLocale('en')
  const english = mount(Waveform, { props: { levels: [] } })
  expect(english.attributes('aria-label')).toBe('Waveform')
  english.unmount()
})

it('keeps caller-owned content unchanged and exposes pseudo prose only in tests', async () => {
  await setTestLocale('en-XA')
  const empty = mount(EmptyState)
  expect(empty.text()).toMatch(/^⟦/)
  empty.unmount()
  const content = mount(EmptyState, { props: { text: '<sample-note.md>' } })
  expect(content.text()).toBe('<sample-note.md>')
  expect(content.find('sample-note').exists()).toBe(false)
  content.unmount()
})
