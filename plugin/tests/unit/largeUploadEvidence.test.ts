import { expect, it } from 'vitest'
import {
  requireLargeUploadSource,
  requireLargeUploadHead,
} from '../e2e/helpers/syncLargeUploadEvidence'

it('reports missing or incomplete disk data before attempting an upload', () => {
  expect(() => requireLargeUploadSource(null, 200, 'sample.bin')).toThrow(
    'source is missing on disk'
  )
  expect(() => requireLargeUploadSource({ type: 'file', size: 12 }, 200, 'sample.bin')).toThrow(
    'expected 200 bytes; disk has 12'
  )
  expect(() =>
    requireLargeUploadSource({ type: 'file', size: 200 }, 200, 'sample.bin')
  ).not.toThrow()
})

it('reports a missing server entry with the local read failure instead of dereferencing it', () => {
  const evidence = {
    disk: { size: 200 },
    log: ['scan: skipped sample.bin: bounded reads unavailable'],
  }
  expect(() => requireLargeUploadHead(undefined, 'sample.bin', evidence)).toThrow(
    'No server manifest entry after syncing sample.bin'
  )
  expect(() => requireLargeUploadHead(undefined, 'sample.bin', evidence)).toThrow(
    'bounded reads unavailable'
  )
  const head = {
    path: 'sample.bin',
    kind: 'attachment' as const,
    size: 200,
    sha: 'a'.repeat(64),
    file_id: 'sample-file',
    version_id: 'sample-version',
    mtime: 1,
  }
  expect(requireLargeUploadHead(head, 'sample.bin', evidence)).toBe(head)
  expect(() =>
    requireLargeUploadHead(
      {
        path: 'sample.bin',
        kind: 'directory',
        file_id: 'sample-directory',
        version_id: 'sample-version',
        mtime: 1,
      },
      'sample.bin',
      evidence
    )
  ).toThrow('server manifest contains a directory')
})
