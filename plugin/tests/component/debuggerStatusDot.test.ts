import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import StatusDot from '@/components/obsidian/StatusDot.vue'
it('exposes a named state without relying on colour', () => {
  const w = mount(StatusDot, { props: { tone: 'orange', label: 'Paused', pulse: false } })
  expect(w.get('[role="status"]').attributes('aria-label')).toBe('Paused')
  expect(w.classes()).toContain('abele-status-dot_orange')
  w.unmount()
})
