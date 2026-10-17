import { describe, expect, it } from 'vitest'
import { forgejoPatch } from '@/forge/forgejoDiff'

describe('Forgejo unified patches', () => {
  it('matches quoted UTF-8 Git paths without treating the path as a web anchor', () => {
    const diff =
      'diff --git "a/src/\\317\\200.ts" "b/src/\\317\\200.ts"\n--- "a/src/\\317\\200.ts"\n+++ "b/src/\\317\\200.ts"\n@@ -1 +1 @@\n-before\n+after\n'
    expect(forgejoPatch(diff, 'src/π.ts', false)).toBe('@@ -1 +1 @@\n-before\n+after\n')
  })
  it('matches deleted files by the old path and leaves binary or missing patches unknown', () => {
    const diff =
      'diff --git a/old file.ts b/old file.ts\n--- a/old file.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n'
    expect(forgejoPatch(diff, 'old file.ts', true)).toContain('-old')
    expect(forgejoPatch('Binary files differ\n', 'image.png', false)).toBeUndefined()
    expect(forgejoPatch(diff, 'different.ts', false)).toBeUndefined()
  })
})
