import { expect, it } from 'vitest'
import { generateChangelog } from '../../scripts/changelog.mjs'
import { compareVersions } from '@/changelog/model'

it('includes every reviewed historical version and stable UTC metadata', () => {
  const releases = generateChangelog()
  expect(
    releases.filter((release) => compareVersions(release.version, '1.58.0')! <= 0)
  ).toHaveLength(122)
  expect(releases.find((release) => release.version === '1.0.1')?.date).toBe('2026-04-18')
  expect(releases.map((release) => release.version)).toContain('1.0.2')
  expect(releases.find((release) => release.version === '0.0.1')?.dateSource).toBe('history')
  expect(releases.find((release) => release.version === '1.20.0')?.dateSource).toBe('history')
  expect(releases.every((release) => /^\d{4}-\d{2}-\d{2}$/.test(release.date))).toBe(true)
  expect(new Set(releases.map((release) => release.version)).size).toBe(releases.length)
}, 45_000)
