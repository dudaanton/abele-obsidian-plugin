import { describe, expect, it } from 'vitest'
import * as shared from '@abele/sync-protocol'
import * as contract from '@/sync/v2/contract'
import * as files from '@/sync/v2/fileSchemas'
import { UploadBeginRequestSchema, UploadReceiptSchema } from '@/sync/v2/uploadSchemas'

const token = {
  v: 1 as const,
  address: 'https://example.test/sync/',
  key: 'a'.repeat(43),
  scope: { kind: 'folder' as const, id: 'sample', path: 'Notes/資料' },
}

describe('shared protocol compatibility', () => {
  it('uses the public schema and encoder exports', () => {
    expect(contract.V2AccessTokenSchema).toBe(shared.V2AccessTokenSchema)
    expect(contract.encodeAccessToken).toBe(shared.encodeAccessToken)
    expect(files.CommitOpSchema).toBe(shared.CommitOpSchema)
    expect(files.CommitOpResultSchema).toBe(shared.CommitOpResultSchema)
  })

  it('normalizes pasted whitespace before decoding Unicode scopes and enforcing length', () => {
    const encoded = contract.encodeAccessToken(token)
    const pasted = encoded.split('').join(' \n\t\u200b'.repeat(40))
    expect(pasted.length).toBeGreaterThan(8192)
    expect(contract.decodeAccessToken(pasted)).toEqual({
      ...token,
      address: 'https://example.test/sync',
    })
  })

  it.each(['!', '/w==', btoa('{'), 'a'.repeat(8196)])('rejects malformed token %#', (text) => {
    expect(() => contract.decodeAccessToken(text)).toThrow(/^Invalid connection token: /)
  })

  it.each([undefined, false, true])(
    'preserves optional read_only %s and strict envelopes',
    (readOnly) => {
      const input = {
        scope: { kind: 'folder', id: 'sample' },
        label: 'Sample',
        read_only: readOnly,
      }
      expect(contract.V2IssueTokenRequestSchema.parse(input)).toEqual(input)
      expect(contract.V2IssueTokenRequestSchema.safeParse({ ...input, extra: true }).success).toBe(
        false
      )
    }
  )

  it('keeps removal distinct from deletion', () => {
    const event = { cursor: 1, file_id: 'sample', path: 'Sample.md', at: '2032-01-02T00:00:00Z' }
    expect(contract.V2ChangeSchema.parse({ ...event, type: 'removal' })).toEqual({
      ...event,
      type: 'removal',
    })
    expect(contract.V2ChangeSchema.safeParse({ ...event, type: 'delete' }).success).toBe(false)
    expect(contract.V2ChangeSchema.parse({ ...event, type: 'delete', version_id: 'v1' }).type).toBe(
      'delete'
    )
    expect(
      contract.V2ChangeSchema.safeParse({ ...event, type: 'removal', version_id: 'v1' }).success
    ).toBe(false)
  })

  it('strips operation and result extras while retaining conflict identities and nullable SHA', () => {
    const op = { op: 'delete', file_id: 'sample', base_version_id: 'v1' }
    expect(files.CommitOpSchema.parse({ ...op, extra: true })).toEqual(op)
    const applied = {
      status: 'applied',
      file_id: 'sample',
      version_id: 'v2',
      seq: 2,
      path: 'Sample.md',
      sha: null,
      size: 0,
      mtime: 0,
    }
    expect(files.CommitOpResultSchema.parse({ ...applied, extra: true })).toEqual(applied)
    const conflict = {
      ...applied,
      status: 'conflict',
      sha: 'a'.repeat(64),
      conflict_path: 'Conflict.md',
      conflict_file_id: 'other',
      conflict_version_id: 'v3',
    }
    expect(files.CommitOpResultSchema.parse({ ...conflict, extra: true })).toEqual(conflict)
    const { conflict_file_id: _missing, ...incomplete } = conflict
    expect(files.CommitOpResultSchema.safeParse(incomplete).success).toBe(false)
  })

  it.each([0, 100, 'invalid'])(
    'strips max_part_bytes without validating it: %s',
    (maxPartBytes) => {
      expect(
        UploadBeginRequestSchema.parse({ size: 1, max_part_bytes: maxPartBytes, extra: true })
      ).toEqual({ size: 1 })
    }
  )

  it('keeps the local receipt strict until its shared export is available', () => {
    const receipt = { sha: 'a'.repeat(64), size: 0 }
    expect(UploadReceiptSchema.parse(receipt)).toEqual(receipt)
    for (const invalid of [
      { ...receipt, sha: 'A'.repeat(64) },
      { ...receipt, size: -1 },
      { ...receipt, size: 0.5 },
      { ...receipt, extra: true },
    ]) {
      expect(UploadReceiptSchema.safeParse(invalid).success).toBe(false)
    }
  })

  it.fails('BUG: shared file-operation integers must retain the safe-integer bound', () => {
    expect(
      files.CommitOpSchema.safeParse({
        op: 'create',
        path: 'Sample.md',
        sha: 'a'.repeat(64),
        size: Number.MAX_SAFE_INTEGER + 1,
        mtime: 0,
      }).success
    ).toBe(false)
  })

  it.fails('BUG: shared upload integers must retain the safe-integer bound', () => {
    expect(UploadBeginRequestSchema.safeParse({ size: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(
      false
    )
  })
})
