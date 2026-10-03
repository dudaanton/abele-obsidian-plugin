// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
describe('native copied plugin stylesheet contract', () => {
  it('backs up/installs/restores the styles.css path Obsidian actually loads', () => {
    const runner = readFileSync(
      new URL('../../scripts/run-agent-stand.mjs', import.meta.url),
      'utf8'
    )
    expect(runner).toContain("'styles.css'")
    expect(runner).toContain("f === 'styles.css'")
  })
})
