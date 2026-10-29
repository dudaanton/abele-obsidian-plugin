import { expect, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

/** A gutter selection opens the teleported menu; picking an action clears that selection. */
export async function pickGithubFloatingAction(action: 'link' | 'code') {
  const selector = `.abele-selection-bar [data-action="${action}"]`
  await vi.waitFor(() => expect(document.querySelectorAll(selector)).toHaveLength(1))
  document.querySelector<HTMLElement>(selector)!.click()
  await flushPromises()
}
