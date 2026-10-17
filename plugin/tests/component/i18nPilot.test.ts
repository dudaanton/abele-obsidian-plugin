import { afterEach, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Waveform from '@/components/obsidian/Waveform.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import { initializeLocale } from '@/i18n'
import { setTestLocale } from '@/testing/i18nLocale'

afterEach(() => initializeLocale('en'))

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
