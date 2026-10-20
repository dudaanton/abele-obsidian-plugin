/**
 * A blame line's details — author and date, the sha, the whole message and a way to the commit —
 * in the kit's dialog, after a right click or a long press on the line.
 */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import GithubBlameRange from '@/components/github/GithubBlameRange.vue'
import { formatDate } from '@/github/format'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))
enableAutoUnmount(afterEach)
afterEach(() => document.body.replaceChildren())

const commit = {
  sha: 'a'.repeat(40),
  author: 'Sample Author',
  date: '2025-02-03T12:00:00Z',
  message: 'Sample change\n\nA longer sample body.',
}

it('shows only author and relative date in the row, keeping the full message in its tooltip', () => {
  const wrapper = mount(GithubBlameRange, { props: { commit } })
  expect(wrapper.get('.abele-github-blame-range__author').text()).toBe('Sample Author')
  expect(wrapper.get('.abele-github-blame-range__date').text()).not.toBe('')
  expect(wrapper.get('button').text()).not.toContain('Sample change')
  expect(wrapper.get('button').attributes('aria-label')).toContain(commit.message)
})

it('retains the account identity for repository authors with a login', () => {
  const wrapper = mount(GithubBlameRange, {
    props: { commit: { ...commit, login: 'sample-login' } },
  })
  expect(wrapper.get('.abele-github-blame-range__author').text()).toBe('sample-login')
})

it('shows the commit in a dialog and opens it from there', async () => {
  const wrapper = mount(GithubBlameRange, {
    props: { commit: commit as never },
    attachTo: document.body,
  })
  await wrapper.get('.abele-github-blame-range__open').trigger('contextmenu')
  await flushPromises()
  const modal = document.querySelector<HTMLElement>('.modal')!
  expect(modal.querySelector('.abele-github-blame-detail-body p')?.textContent).toBe(
    `Sample Author · ${formatDate(commit.date)}`
  )
  expect(modal.textContent).toContain(commit.sha)
  expect(modal.querySelector('.abele-github-blame-details')?.textContent).toBe(commit.message)
  const open = [...modal.querySelectorAll('button')].find((b) => b.textContent === 'Open commit')!
  open.click()
  await flushPromises()
  expect(wrapper.emitted('open')).toEqual([[commit.sha]])
  expect(document.querySelector('.modal')).toBeNull()
})

it('closes its dialog with the line', async () => {
  const wrapper = mount(GithubBlameRange, {
    props: { commit: commit as never },
    attachTo: document.body,
  })
  await wrapper.get('.abele-github-blame-range__open').trigger('contextmenu')
  await flushPromises()
  expect(document.querySelector('.modal')).not.toBeNull()
  wrapper.unmount()
  expect(document.querySelector('.modal')).toBeNull()
})
