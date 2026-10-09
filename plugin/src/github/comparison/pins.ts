import { shallowRef } from 'vue'
import { sourceKey, type RepositoryIdentity, type RepositorySource } from '@/repository/source'
import { commitSha } from '../api'
import type { GithubClient } from '../client'
import { repoApiPath } from '../contents'

export interface Repository {
  host: string
  origin?: string
  owner: string
  repo: string
}
export interface BasePin {
  /** Local sources are scoped to opaque workspace identities, never their display labels. */
  source?: Extract<RepositoryIdentity, { provider: 'node' }>
  origin: string
  owner: string
  repo: string
  enteredRef: string
  baseSha: string
}
export interface LocalStorage {
  loadLocalStorage(key: string): unknown
  saveLocalStorage(key: string, value: unknown): void
}
export const PIN_KEY = 'abele-github-comparison-bases'
export const repositoryKey = (repo: Repository) =>
  `${new URL(repo.origin ?? `https://${repo.host}`).origin}/${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}`
const pinKey = (repo: Repository, source?: RepositoryIdentity) =>
  source?.provider === 'node' ? sourceKey(source) : repositoryKey(repo)

/** Reading context, deliberately outside synced settings and settings transfer. */
export class BasePins {
  readonly version = shallowRef(0)
  private pins = new Map<string, BasePin>()
  constructor(private readonly storage: LocalStorage) {
    const stored = storage.loadLocalStorage(PIN_KEY)
    if (!Array.isArray(stored)) return
    for (const row of stored) {
      if (
        !row ||
        typeof row !== 'object' ||
        !/^[a-f\d]{40}$/i.test(row.baseSha) ||
        ![row.origin, row.owner, row.repo, row.enteredRef].every((v) => typeof v === 'string' && v)
      )
        continue
      try {
        const url = new URL(row.origin)
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue
        const pin: BasePin = {
          origin: url.origin,
          owner: row.owner,
          repo: row.repo,
          enteredRef: row.enteredRef,
          baseSha: row.baseSha.toLowerCase(),
        }
        if (row.source !== undefined) {
          const source = row.source
          if (
            !source ||
            source.provider !== 'node' ||
            !['installation', 'node', 'project', 'workspace'].every(
              (key) => typeof source[key] === 'string' && /^[a-zA-Z0-9_-]+$/.test(source[key])
            )
          )
            continue
          pin.source = {
            provider: 'node',
            installation: source.installation,
            node: source.node,
            project: source.project,
            workspace: source.workspace,
          }
        }
        this.pins.set(pinKey({ ...pin, host: url.host }, pin.source), pin)
      } catch {
        /* Ignore malformed local preferences. */
      }
    }
  }
  get(repo: Repository, source?: RepositoryIdentity): BasePin | null {
    void this.version.value
    return this.pins.get(pinKey(repo, source)) ?? null
  }
  async resolve(client: GithubClient, repo: Repository, enteredRef: string): Promise<BasePin> {
    const ref = enteredRef.trim()
    if (!ref) throw new Error('Enter a commit, branch or tag.')
    const baseSha = /^[a-f\d]{40}$/i.test(ref)
      ? (
          await client.get<{ sha: string }>(
            `${repoApiPath(repo)}/commits/${encodeURIComponent(ref)}`,
            { what: 'the comparison base commit' }
          )
        ).sha
      : await commitSha(client, repo, ref)
    client.assertCurrent()
    if (!/^[a-f\d]{40}$/i.test(baseSha))
      throw new Error('GitHub did not resolve that ref to a commit SHA.')
    return {
      origin: new URL(repo.origin ?? `https://${repo.host}`).origin,
      owner: repo.owner.toLowerCase(),
      repo: repo.repo.toLowerCase(),
      enteredRef: ref,
      baseSha: baseSha.toLowerCase(),
    }
  }
  async resolveSource(
    source: RepositorySource,
    repo: Repository,
    enteredRef: string
  ): Promise<BasePin> {
    const ref = enteredRef.trim()
    if (!ref) throw new Error('Enter a commit, branch or tag.')
    const baseSha = await source.resolve(ref, true)
    source.assertCurrent()
    if (!/^[a-f\d]{40}$/i.test(baseSha))
      throw new Error('The source did not resolve that ref to a commit SHA.')
    return {
      ...(source.identity.provider === 'node' ? { source: { ...source.identity } } : {}),
      origin: new URL(repo.origin ?? `https://${repo.host}`).origin,
      owner: repo.owner.toLowerCase(),
      repo: repo.repo.toLowerCase(),
      enteredRef: ref,
      baseSha: baseSha.toLowerCase(),
    }
  }
  save(pin: BasePin): void {
    this.pins.set(pinKey({ ...pin, host: new URL(pin.origin).host }, pin.source), { ...pin })
    this.changed()
  }
  async pin(client: GithubClient, repo: Repository, ref: string): Promise<void> {
    this.save(await this.resolve(client, repo, ref))
  }
  unpin(repo: Repository, source?: RepositoryIdentity): void {
    this.pins.delete(pinKey(repo, source))
    this.changed()
  }
  private changed(): void {
    this.storage.saveLocalStorage(PIN_KEY, [...this.pins.values()])
    this.version.value++
  }
}
const stores = new WeakMap<LocalStorage, BasePins>()
export function basePins(storage: LocalStorage): BasePins {
  let pins = stores.get(storage)
  if (!pins) {
    pins = new BasePins(storage)
    stores.set(storage, pins)
  }
  return pins
}
