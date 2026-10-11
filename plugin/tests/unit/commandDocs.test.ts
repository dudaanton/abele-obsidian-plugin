import { expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { projectCommands } from '../helpers/commandAnalysis'

it('describes every registered palette command in the agent reference', () => {
  const root = path.resolve(import.meta.dirname, '../..')
  const analysis = projectCommands()
  const reference = fs
    .readFileSync(path.join(root, 'src/docs/commands.md'), 'utf8')
    .replace(/\s+/g, ' ')
  const missing: string[] = []
  for (const command of analysis) {
    expect(command.objectLiteral, command.source).toBe(true)
    expect(command.hasName, command.source).toBeTruthy()
    // Vault-defined script names cannot be inventoried, but their palette pattern can.
    if (command.expression === '`Script: ${parsed.meta.name}`') {
      expect(reference).toContain('Script: <name>')
    } else {
      for (const candidate of command.names) {
        expect(
          candidate.literal,
          `Unresolved command name: ${command.source}: ${command.expression}`
        ).toBe(true)
        if (candidate.literal && !reference.includes(candidate.value)) missing.push(candidate.value)
      }
    }
  }
  expect(analysis.length).toBeGreaterThan(0)
  expect([...new Set(missing)].sort()).toEqual([])
  // Building the TypeScript program shares CPU with the whole fast tier; this is not a speed assertion.
}, 30_000)
