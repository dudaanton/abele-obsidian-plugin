import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import GithubBlob from '@/components/github/GithubBlob.vue'
import { GithubClient, GithubError } from '@/github/client'
import { endpoints } from '@/github/urls'
import { useVault } from '../helpers/testEnv'

const file = {
  host: 'github.com',
  owner: 'sample-org',
  repo: 'sample-repo',
  ref: 'topic/sample',
  path: 'sample.ts',
}
const sha = 'a'.repeat(40)
const response = (start = 1, end = 3) => ({
  repository: {
    object: {
      blame: {
        ranges: [
          {
            startingLine: start,
            endingLine: end,
            commit: {
              oid: sha,
              message: 'Sample change\n\nFull details',
              committedDate: '2025-02-03T12:00:00Z',
              author: { name: 'Sample Author' },
            },
          },
        ],
      },
    },
  },
})
const toggle = (w: ReturnType<typeof mount>) =>
  w.get('button[aria-label="Toggle line blame"]').trigger('click')
function setup(text = 'one\ntwo\nthree') {
  const client = new GithubClient(endpoints(''), 'sample-token')
  const request = vi.spyOn(client, 'graphql').mockResolvedValue(response())
  const wrapper = mount(GithubBlob, { props: { file, text, client }, attachTo: document.body })
  return { wrapper, client, request }
}
beforeEach(() => useVault([]))
enableAutoUnmount(afterEach)
afterEach(() => vi.restoreAllMocks())

describe('line blame in the file view', () => {
  it('loads only on demand, groups lines, opens the commit inside the tab, and toggles off', async () => {
    const { wrapper, request } = setup()
    await flushPromises()
    expect(request).not.toHaveBeenCalled()
    await toggle(wrapper)
    await flushPromises()
    expect(wrapper.findAll('.abele-github-blame-range')).toHaveLength(1)
    const range = wrapper.get('.abele-github-blame-range')
    expect(range.text()).toContain('Sample Author')
    expect(range.text()).toContain('Sample change')
    await range.get('button').trigger('click')
    expect(wrapper.emitted('open')?.[0]).toEqual([
      `https://github.com/sample-org/sample-repo/commit/${sha}`,
    ])
    await toggle(wrapper)
    expect(wrapper.find('.abele-github-blame').exists()).toBe(false)
    await toggle(wrapper)
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('temporarily shows markdown source without changing the stored preview preference', async () => {
    const { wrapper } = setup('# Sample\n\nText')
    await wrapper.setProps({ file: { ...file, path: 'sample.md' }, mode: 'preview' })
    await flushPromises()
    expect(wrapper.find('.abele-github-md').exists()).toBe(true)
    await toggle(wrapper)
    await flushPromises()
    expect(wrapper.find('.cm-editor').exists()).toBe(true)
    expect(wrapper.find('.abele-tabs__tab_active').text()).toBe('Code')
    await toggle(wrapper)
    await flushPromises()
    expect(wrapper.find('.abele-github-md').exists()).toBe(true)
    expect(wrapper.emitted('mode')).toBeUndefined()
  })
  it('leaves the source readable on refusal and offers a real retry', async () => {
    const { wrapper, request } = setup()
    request.mockRejectedValueOnce(new GithubError('auth', 'Sample permission is missing'))
    await toggle(wrapper)
    await flushPromises()
    expect(wrapper.get('.abele-github-notice').text()).toContain('Sample permission is missing')
    expect(wrapper.get('.cm-content').text()).toContain('one')
    await wrapper.get('.abele-github-notice button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.abele-github-notice').exists()).toBe(false)
    expect(wrapper.find('.abele-github-blame-range').exists()).toBe(true)
  })
  it('ignores an old response after the file or connection changes', async () => {
    const { wrapper, request } = setup()
    let resolve!: (value: unknown) => void
    request.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    await toggle(wrapper)
    await wrapper.setProps({ file: { ...file, path: 'other.ts' } })
    resolve(response())
    await flushPromises()
    expect(wrapper.find('.abele-github-blame-range').exists()).toBe(false)
    expect(wrapper.get('button[aria-label="Toggle line blame"]').attributes('aria-pressed')).toBe(
      'false'
    )
  })
  it('renders only visible ranges in a large source file', async () => {
    const { wrapper, request } = setup(
      Array.from({ length: 20000 }, (_, i) => `sample ${i}`).join('\n')
    )
    request.mockResolvedValue({
      repository: {
        object: {
          blame: {
            ranges: Array.from({ length: 20000 }, (_, i) => ({
              ...response(i + 1, i + 1).repository.object.blame.ranges[0],
              commit: { ...response().repository.object.blame.ranges[0].commit, oid: String(i) },
            })),
          },
        },
      },
    })
    await toggle(wrapper)
    await flushPromises()
    expect(wrapper.findAll('.abele-github-blame-range').length).toBeGreaterThan(0)
    expect(wrapper.findAll('.abele-github-blame-range').length).toBeLessThan(200)
  })
})
