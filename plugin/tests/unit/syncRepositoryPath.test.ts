// @vitest-environment node
import { expect, it } from 'vitest'
import { syncRepositoryFrom, locateSyncRepository } from '../../scripts/sync-repository.mjs'

it('finds the sibling from a main checkout using a relative common Git directory', () => {
  expect(syncRepositoryFrom('/sample/projects/plugin/plugin', '.git')).toBe(
    '/sample/projects/abele-sync'
  )
})

it('finds the same sibling from a deeply nested worktree without a symlink', () => {
  expect(
    syncRepositoryFrom(
      '/sample/projects/worktrees/plugin/topic/plugin',
      '/sample/projects/plugin/.git'
    )
  ).toBe('/sample/projects/abele-sync')
  expect(
    syncRepositoryFrom('/sample/projects/worktrees/plugin/topic/plugin', '../../../plugin/.git')
  ).toBe('/sample/projects/abele-sync')
})

it('uses the actual common Git directory without reading or changing a sibling checkout', () => {
  expect(locateSyncRepository(process.cwd())).toMatch(/\/abele-sync$/)
  expect(locateSyncRepository(process.cwd())).not.toContain('/worktrees/')
})
