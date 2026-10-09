// Retained file-operation schemas from protocol 10e8f23 (file schemas unchanged).
import { z } from 'zod'
import { ERROR_CODES, FILE_KINDS } from '@abele/sync-protocol'
export const PathSchema = z.string().min(1).max(1024)
export const ShaSchema = z.string().regex(/^[0-9a-f]{64}$/)
export const FileKindSchema = z.enum(FILE_KINDS)
const ErrorCodeSchema = z.enum(ERROR_CODES)
const id = z.string().min(1)
const bytes = z.number().int().nonnegative()
const mtime = bytes
const seq = z.number().int().positive()
export const JoinPreferSchema = z.enum(['mine', 'theirs'])
export type JoinPrefer = z.infer<typeof JoinPreferSchema>

export const CommitOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('create'),
    path: PathSchema,
    sha: ShaSchema,
    size: bytes,
    mtime,
    prefer: JoinPreferSchema.optional(),
  }),
  z.object({
    op: z.literal('modify'),
    file_id: id,
    base_version_id: id,
    sha: ShaSchema,
    size: bytes,
    mtime,
  }),
  z.object({ op: z.literal('delete'), file_id: id, base_version_id: id }),
  z.object({
    op: z.literal('move'),
    file_id: id,
    base_version_id: id,
    to_path: PathSchema,
  }),
  z.object({ op: z.literal('restore'), file_id: id, version_id: id }),
])
export type CommitOp = z.infer<typeof CommitOpSchema>

export const CommitRequestSchema = z.object({
  ops: z.array(CommitOpSchema).min(1).max(1000),
})
export type CommitRequest = z.infer<typeof CommitRequestSchema>

export const CommitOpResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('applied'),
    creation: z.enum(['novel', 'adopted', 'collision']).optional(),
    file_id: id,
    version_id: id,
    seq,
    path: PathSchema,
    /**
     * What the version this left as the head holds. It is what the op sent, except where the
     * server carried the head's own bytes across — a move over a head that had been edited
     * since the device's base — so a device records the sha of the version it now names
     * rather than the sha it happened to have on disk. Null for a delete.
     */
    sha: ShaSchema.nullable(),
    size: bytes,
    mtime,
  }),
  z.object({
    status: z.literal('merged'),
    creation: z.enum(['novel', 'adopted', 'collision']).optional(),
    file_id: id,
    version_id: id,
    seq,
    path: PathSchema,
    sha: ShaSchema,
    size: bytes,
    mtime,
  }),
  z.object({
    status: z.literal('conflict'),
    creation: z.enum(['novel', 'adopted', 'collision']).optional(),
    file_id: id,
    version_id: id,
    seq,
    path: PathSchema,
    /** The head that stayed at `path`, so the device can fetch it without waiting for the feed. */
    sha: ShaSchema,
    size: bytes,
    mtime,
    conflict_path: PathSchema,
    conflict_file_id: id,
    conflict_version_id: id,
  }),
  z.object({ status: z.literal('rejected'), code: ErrorCodeSchema, message: z.string() }),
])
export type CommitOpResult = z.infer<typeof CommitOpResultSchema>
