import { describe, expect, it, vi } from 'vitest'
import { BasePicker } from '@/github/comparison/BasePicker'
import { basePins, type BasePin } from '@/github/comparison/pins'
import type { RepositorySource } from '@/repository/source'

const storage = () => {
  const values = new Map<string, unknown>()
  return {
    loadLocalStorage: (key: string) => values.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => values.set(key, value),
  }
}
const identity = {
  provider: 'node' as const,
  node: 'node-sample',
  project: 'project-sample',
  workspace: 'workspace-sample',
}
const repo = { host: 'node.invalid', owner: 'Sample node', repo: 'Sample project' }
const pin: BasePin = {
  source: identity,
  origin: 'https://node.invalid',
  owner: 'sample node',
  repo: 'sample project',
  enteredRef: 'main',
  baseSha: 'a'.repeat(40),
}
describe('choosing a comparison base', () => {
  it('hands the chosen version to the caller instead of pinning it when asked to', () => {
    const app = storage(),
      choose = vi.fn()
    const source = { identity, assertCurrent() {} } as unknown as RepositorySource
    new BasePicker(app as never, source, repo, choose).onChooseSuggestion({ name: 'main', pin })
    expect(choose).toHaveBeenCalledWith(pin)
    expect(basePins(app as never).get(repo, identity)).toBeNull()
  })
  it('still pins the base for the repository views when nobody takes it', () => {
    const app = storage()
    const source = { identity, assertCurrent() {} } as unknown as RepositorySource
    new BasePicker(app as never, source, repo).onChooseSuggestion({ name: 'main', pin })
    expect(basePins(app as never).get(repo, identity)?.baseSha).toBe(pin.baseSha)
  })
})
