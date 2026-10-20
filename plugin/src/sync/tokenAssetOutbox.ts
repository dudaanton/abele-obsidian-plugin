import { sha256 } from './external/hash'
import { z } from 'zod'
import { type StateStore, type ChunkSource, fingerprintSource } from '@abele/sync-sdk/core'
import { V2CommitResponseSchema, normalisePath, validatePath } from '@abele/sync-sdk/protocol'

const candidate = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1),
    sha: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.array(z.number().int().min(0).max(255)),
    source: z
      .object({ id: z.string().min(1), size: z.number().int().nonnegative() })
      .strict()
      .optional(),
    mtime: z.number().int().nonnegative(),
    key: z.string().min(1),
    binding: z.string().min(1),
    baseVersion: z.string().nullable().optional(),
    hold: z.object({ code: z.string(), message: z.string() }).optional(),
    uncertain: z.string().optional(),
  })
  .strict()
type Candidate = z.infer<typeof candidate>
const queueSchema = z.array(candidate)
const QUEUE = 'token-asset-outbox'
export const ASSET_IDENTITIES = 'token-asset-identities'
export const assetIdentitiesSchema = z.array(
  z.object({ id: z.string().min(1), fileId: z.string().min(1) }).strict()
)
const markerOf = (one: { id: string; path: string; sha: string; mtime: number }) =>
  'token-asset-publication:' + JSON.stringify([one.id, one.path, one.sha, one.mtime])
const errorOf = (code: string, message: string) => Object.assign(new Error(message), { code })
const sizeOf = (one: { bytes: { length: number }; source?: { size: number } }) =>
  one.source?.size ?? one.bytes.length

/** Independent per-file requests, serialized durable queue mutations, exact uncertain replay.
 * A known refusal is retained separately from uncertain work and never blocks receiving. */
export class TokenAssetOutbox {
  private readonly flights = new Map<string, Promise<Map<string, unknown>>>()
  private operations: Promise<void> = Promise.resolve()
  private cached: Candidate[] = []
  private recovery: string | null = null
  private readonly refused = new Map<string, { path: string; reason: string; key: string }>()
  constructor(
    private readonly options: {
      state: StateStore
      binding(): string
      assertOwned(): void
      serial<T>(work: () => Promise<T>): Promise<T>
      approved(id: string): Promise<boolean>
      maxBytes(): number
      send(one: Candidate, bytes: Uint8Array): Promise<unknown>
      openSource?(id: string): Promise<ChunkSource>
      sendSource?(one: Candidate, source: ChunkSource): Promise<unknown>
      discardSource?(id: string): Promise<void>
      changed(): void
    }
  ) {}
  private local<T>(work: () => Promise<T>): Promise<T> {
    const next = this.operations.then(work)
    this.operations = next.then(
      () => {},
      () => {}
    )
    return next
  }
  private read(): Promise<Candidate[]> {
    return this.local(async () => {
      try {
        const queue = await this.list()
        this.cached = queue
        this.recovery = null
        return queue
      } catch (error) {
        this.recovery = error instanceof Error ? error.message : 'Publication recovery required'
        this.options.changed()
        throw error
      }
    })
  }
  /**
   * Validates the durable queue after a connection handshake. It runs inside the engine's
   * exclusive cycle, so it must not wait behind a queued recording, which itself waits for
   * that cycle to finish. Nothing can commit to the queue while the cycle holds the engine.
   */
  async restore(): Promise<void> {
    try {
      this.cached = await this.list()
      this.recovery = null
    } catch (error) {
      this.recovery = error instanceof Error ? error.message : 'Publication recovery required'
      this.options.changed()
      throw error
    }
  }
  async close(): Promise<void> {
    await Promise.allSettled([...this.flights.values()])
    await this.operations
  }
  private async list(): Promise<Candidate[]> {
    this.options.assertOwned()
    if (!this.options.state.getMeta || !this.options.state.setMeta)
      throw new Error('Durable publication storage is unavailable')
    const raw = await this.options.state.getMeta(QUEUE),
      queue = queueSchema.parse(JSON.parse(raw ?? '[]'))
    if (
      new Set(queue.map((one) => one.key)).size !== queue.length ||
      queue.some((one) => one.binding !== this.options.binding())
    )
      throw new Error('Publication recovery required: source identity changed')
    for (const one of queue) {
      let sha: string
      if (one.source) {
        if (one.bytes.length || !this.options.openSource)
          throw new Error('Publication source requires recovery')
        const identity = await fingerprintSource(await this.options.openSource(one.source.id))
        if (identity.size !== one.source.size) throw new Error('Publication source size changed')
        sha = identity.sha
      } else sha = await sha256(new Uint8Array(one.bytes))
      if (sha !== one.sha)
        throw new Error('Publication recovery required: retained content changed')
      else validatePath(normalisePath(one.path))
    }
    this.options.assertOwned()
    return queue
  }
  private mutate<T>(work: (queue: Candidate[]) => Promise<T>): Promise<T> {
    return this.local(async () => {
      let committed: Candidate[] | undefined
      const result = await this.options.serial(() =>
        this.options.state.transaction(async () => {
          const queue = await this.list(),
            result = await work(queue)
          this.options.assertOwned()
          await this.options.state.setMeta(QUEUE, JSON.stringify(queue))
          committed = structuredClone(queue)
          return result
        })
      )
      this.cached = committed!
      this.recovery = null
      return result
    })
  }
  async enqueue(input: {
    id: string
    path: string
    sha: string
    bytes: Uint8Array
    source?: { id: string; size: number }
    mtime: number
  }): Promise<string> {
    if (sizeOf(input) > this.options.maxBytes()) {
      const reason = 'This file is too large for this server'
      this.refused.set(input.id, { path: input.path, reason, key: input.id })
      this.options.changed()
      throw errorOf('too_large', reason)
    }
    this.refused.delete(input.id)
    const marker = markerOf(input)
    const key = await this.mutate(async (queue) => {
      const prior = await this.options.state.getMeta(marker),
        key = prior ?? crypto.randomUUID()
      if (!prior) await this.options.state.setMeta(marker, key)
      if (
        !(await this.options.state.getMeta('token-asset-settled:' + key)) &&
        !queue.some((one) => one.key === key)
      )
        queue.push(
          candidate.parse({
            ...input,
            bytes: [...input.bytes],
            key,
            binding: this.options.binding(),
            baseVersion: (await this.options.state.get(input.path))?.versionId ?? null,
          })
        )
      return key
    })
    this.options.changed()
    return key
  }
  state(): { path: string; reason: string; key: string }[] {
    if (this.recovery) return [{ path: 'A file', reason: this.recovery, key: 'recovery' }]
    return [
      ...this.refused.values(),
      ...this.cached.map((one) => ({
        path: one.path,
        key: one.key,
        reason: one.hold?.message ?? one.uncertain ?? 'The file is waiting to be sent',
      })),
    ]
  }
  private async process(id: string, retryHeld: boolean): Promise<Map<string, unknown>> {
    const errors = new Map<string, unknown>(),
      attempted = new Set<string>()
    for (;;) {
      let one = (await this.read()).find(
        (item) => item.id === id && !attempted.has(item.key) && (!item.hold || retryHeld)
      )
      if (!one) return errors
      attempted.add(one.key)
      try {
        this.options.assertOwned()
        // A changed limit cannot turn an unanswered request into a known refusal.
        // Reconcile that request with its original key before considering a new attempt.
        if (one.uncertain === undefined && sizeOf(one) > this.options.maxBytes()) {
          const refusal = { code: 'too_large', message: 'This file is too large for this server' }
          await this.mutate(async (queue) => {
            const current = queue.find((item) => item.key === one.key)
            if (current) current.hold = refusal
          })
          errors.set(one.key, errorOf(refusal.code, refusal.message))
          continue
        }
        if (!(await this.options.approved(one.id))) {
          errors.set(
            one.key,
            errorOf(
              'consent_required',
              'The retained file requires its original local identity and permission'
            )
          )
          break
        }
        if (one.hold) {
          const old = one.key
          one = await this.mutate(async (queue) => {
            const current = queue.find((item) => item.key === old)
            if (!current || !current.hold) throw new Error('Publication retry changed')
            current.key = crypto.randomUUID()
            await this.options.state.setMeta(
              'token-asset-rejection:' + old,
              JSON.stringify(current.hold)
            )
            await this.options.state.setMeta(markerOf(current), current.key)
            delete current.hold
            delete current.uncertain
            return structuredClone(current)
          })
          attempted.add(one.key)
        }
        let answer: unknown
        if (one.source) {
          if (!this.options.sendSource || !this.options.openSource)
            throw new Error('Publication source is unavailable')
          const source = await this.options.openSource(one.source.id)
          try {
            answer = await this.options.sendSource(one, source)
          } finally {
            await source.close()
          }
        } else answer = await this.options.send(one, new Uint8Array(one.bytes))
        const response = V2CommitResponseSchema.parse(answer)
        this.options.assertOwned()
        if (response.results.length !== 1)
          throw new Error('Publication response does not identify the retained candidate')
        const result = response.results[0]
        if (result.status === 'rejected') {
          await this.mutate(async (queue) => {
            const current = queue.find((item) => item.key === one.key)
            if (!current) throw new Error('Publication candidate disappeared')
            current.hold = { code: result.code, message: result.message }
            delete current.uncertain
          })
          errors.set(one.key, errorOf(result.code, result.message))
          continue
        }
        if (
          result.path !== normalisePath(one.path) ||
          result.sha !== one.sha ||
          result.size !== sizeOf(one) ||
          result.mtime !== one.mtime ||
          !result.file_id ||
          !result.version_id
        )
          throw new Error('Publication response does not match the retained candidate')
        await this.mutate(async (queue) => {
          const prior = await this.options.state.get(one.path),
            identity = await this.options.state.byFileId(result.file_id)
          if (
            (prior?.versionId ?? null) === (one.baseVersion ?? null) &&
            (!identity || identity.path === one.path)
          )
            await this.options.state.put({
              path: one.path,
              wirePath: result.path,
              fileId: result.file_id,
              versionId: result.version_id,
              sha: result.sha,
              size: result.size,
              mtime: result.mtime,
            })
          await this.options.state.setMeta(
            ASSET_IDENTITIES,
            JSON.stringify([
              ...assetIdentitiesSchema
                .parse(JSON.parse((await this.options.state.getMeta(ASSET_IDENTITIES)) ?? '[]'))
                .filter((item) => item.id !== one.id),
              { id: one.id, fileId: result.file_id },
            ])
          )
          await this.options.state.setMeta(
            'token-asset-settled:' + one.key,
            JSON.stringify({ binding: one.binding, result })
          )
          const index = queue.findIndex((item) => item.key === one.key)
          if (index < 0) throw new Error('Publication candidate disappeared')
          queue.splice(index, 1)
        })
        if (one.source && this.options.discardSource) {
          try {
            await this.options.discardSource(one.source.id)
          } catch (error) {
            console.debug('[abele-sync] retained publication stage cleanup pending', error)
          }
        }
      } catch (error) {
        errors.set(one.key, error)
        try {
          await this.mutate(async (queue) => {
            const current = queue.find((item) => item.key === one.key)
            if (current && !current.hold)
              current.uncertain =
                error instanceof Error ? error.message : 'The publication response is unavailable'
          })
        } catch {
          /* Keep the original request and the original error if bookkeeping also fails. */
        }
        // A missing response or a failed local receipt commit retains the exact request.
        // Do not retry or send a later candidate of this file in the same pass.
        break
      } finally {
        this.options.changed()
      }
    }
    return errors
  }
  async drain(retryHeld = false, focus?: string): Promise<void> {
    const queue = await this.read(),
      ids = [...new Set(queue.filter((one) => !one.hold || retryHeld).map((one) => one.id))]
    const results = await Promise.all(
      ids.map(async (id) => {
        let flight = this.flights.get(id)
        if (flight === undefined) {
          flight = this.process(id, retryHeld)
          this.flights.set(id, flight)
          void flight
            .finally(() => {
              if (this.flights.get(id) === flight) this.flights.delete(id)
            })
            .catch(() => {})
        }
        return flight
      })
    )
    const error = focus
      ? results.map((result) => result.get(focus)).find((value) => value !== undefined)
      : results.flatMap((result) => [...result.values()])[0]
    if (error !== undefined) throw error
    if (focus) {
      const retained = (await this.read()).find((one) => one.key === focus)
      if (retained?.hold) throw errorOf(retained.hold.code, retained.hold.message)
      if (retained)
        throw errorOf(
          'publication_pending',
          'The file remains pending while an earlier request waits for confirmation'
        )
    }
  }
}
