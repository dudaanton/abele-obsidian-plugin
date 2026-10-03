// @vitest-environment node
import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { requireRoutableOwnedPool } from '../../scripts/agent-stand-window.mjs'
it('a failed scoped heartbeat stops without launching, restarting or quitting any app', () => {
  expect(() => requireRoutableOwnedPool({ probe: () => false })).toThrow(/stop and report.*manager/)
  expect(() => requireRoutableOwnedPool({ probe: () => true })).not.toThrow()
})
it('an unresponsive owned-vault CLI cannot trigger any automatic app or URI launch', () => {
  const source = readFileSync(new URL('../../scripts/run-agent-stand.mjs', import.meta.url), 'utf8')
  expect(source).not.toContain("spawnSync('open'")
  expect(source).not.toContain('obsidian://open')
  expect(source).toContain('requireRoutableOwnedPool')
})
