import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import GithubFiles from '@/components/github/GithubFiles.vue'
import type { DiffFile } from '@/repository/model'
import { useVault } from '../helpers/testEnv'

const pending = (path: string, patch: string, counts: [number, number]) => {
  let release!: () => void
  const ready = new Promise<void>((resolve) => (release = resolve))
  const file: DiffFile = reactive({
    path,
    status: 'added',
    additions: 0,
    deletions: 0,
    countsPending: true,
    hash: path,
    reviewComments: [],
    loadPatch: async () => {
      await ready
      file.patch = patch
      file.additions = counts[0]
      file.deletions = counts[1]
      file.countsPending = false
    },
  })
  return { file, release }
}
describe('line counts of a changed file', () => {
  it('shows no count until the diff that carries it has loaded, never a made-up zero', async () => {
    useVault([])
    const added = pending('sample-added.txt', '@@ -0,0 +1,2 @@\n+one\n+two\n', [2, 0]),
      removed = pending('sample-removed.txt', '@@ -1 +0,0 @@\n-gone\n', [0, 1])
    const wrapper = mount(GithubFiles, { props: { files: [added.file, removed.file] } })
    try {
      await flushPromises()
      const counts = () =>
        wrapper
          .findAll('.abele-github-file__stats')
          .map((stats) => stats.text().replace(/\s+/g, ''))
      const total = () => wrapper.find('.abele-github-files__summary').text().replace(/\s+/g, '')
      expect(counts()).toEqual(['', ''])
      expect(total()).toBe('2fileschanged')
      added.release()
      await flushPromises()
      expect(counts()).toEqual(['+2−0', ''])
      expect(total()).toBe('2fileschanged')
      removed.release()
      await flushPromises()
      expect(counts()).toEqual(['+2−0', '+0−1'])
      expect(total()).toBe('2fileschanged+2−1')
    } finally {
      wrapper.unmount()
    }
  })
})
