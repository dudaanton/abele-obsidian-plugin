import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps author avatars within the quiet metadata line height', () => {
  const source = readFileSync('src/components/repository/RepositoryRow.vue', 'utf8')
  const metadata = source.match(/\.abele-repository-row__meta\s*\{([^}]+)\}/)?.[1]
  expect(metadata).toBeDefined()
  expect(metadata).toMatch(
    /--abele-avatar-size:\s*calc\(var\(--font-ui-smaller\)\s*\*\s*var\(--line-height-tight\)\);/
  )
  expect(metadata).toMatch(/line-height:\s*var\(--line-height-tight\);/)
})
