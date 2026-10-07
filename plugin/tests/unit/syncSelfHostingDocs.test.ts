// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it.each([
  '../README.md',
  '../docs/Sync.md',
  'src/docs/settings.md',
  'src/docs/vault.md',
  'src/docs/commands.md',
])('states the self-hosted server requirement in %s', (path) => {
  const text = readFileSync(path, 'utf8').toLowerCase()
  expect(text).toMatch(/self-hosted[\s\S]{0,60}abele-sync/)
  expect(text).toContain('no hosted service')
})
