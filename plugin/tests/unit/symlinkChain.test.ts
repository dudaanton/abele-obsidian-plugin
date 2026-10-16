import { expect, it } from 'vitest'
import { crossesSymlink } from '@/sync/symlinkChain'

const missing = () => Object.assign(new Error('no such file or directory'), { code: 'ENOENT' })

it('treats missing ancestors as no link, so a nested folder can still be made', async () => {
  const probe = async (path: string) => {
    if (path !== 'Root') throw missing()
    return false
  }
  expect(await crossesSymlink('Root/empty/child', probe)).toBe(false)
})

it('refuses a path under an existing symlinked ancestor and rethrows other failures', async () => {
  expect(await crossesSymlink('Linked/empty/child', async (path) => path === 'Linked')).toBe(true)
  await expect(
    crossesSymlink('Root/child', async () => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
    })
  ).rejects.toThrow('permission denied')
})
