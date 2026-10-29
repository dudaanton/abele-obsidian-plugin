import { t } from '@/i18n'
import { shallowRef } from 'vue'
import type { NodeClient } from '@abele/node-client'
import { NodeDocumentSource } from '@/node/NodeFilesModel'
import { NodePathClientPort, pathPages } from '@/node/NodePathClientPort'
import { untilAborted } from './lifetime'
import type { PathTarget } from '@/node/NodePathModel'
import type { RequestFilePort } from './FileCollections'
import { parseRequestFile } from './files'
import { credential, SECRET_NAME, scrubSecrets } from './importers/shared'

/** Reuses the node's independent watch leases and durable conditional document writes. */
export class NodeRequestFiles implements RequestFilePort {
  private target = shallowRef<PathTarget>()
  private source?: NodeDocumentSource
  private preparing?: Promise<PathTarget>
  private sensitiveClient?: NodeClient
  private sensitiveSource?: NodeDocumentSource
  private sensitiveWork: Promise<void> = Promise.resolve()
  private conflicts = new Map<string, string | null>()
  private readonly path: NodePathClientPort
  constructor(
    private readonly client: NodeClient,
    private readonly identity: { nodeId: string; registrationId: string; projectId: string },
    private readonly connect: () => Promise<void>,
    private readonly worktreeId?: string,
    private readonly transientClient?: () => NodeClient
  ) {
    this.path = new NodePathClientPort(client, identity)
  }
  matches(worktree: string) {
    return (
      this.target.value?.id === worktree || (!!this.target.value && this.worktreeId === worktree)
    )
  }
  ready(): Promise<PathTarget> {
    if (this.target.value && this.client.connected) return Promise.resolve(this.target.value)
    return (this.preparing ??= this.prepare().finally(() => {
      this.preparing = undefined
    }))
  }
  private async prepare() {
    await this.connect()
    if (this.target.value) return this.target.value
    let cursor: string | undefined
    try {
      do {
        const page = await this.client.repository.worktrees({
          project_id: this.identity.projectId,
          cursor,
        })
        const root = page.entries.find((entry) =>
          this.worktreeId
            ? entry.worktree_id === this.worktreeId || entry.workspace_id === this.worktreeId
            : entry.kind === 'root'
        )
        if (root) {
          this.target.value = { ...this.identity, kind: 'worktree', id: root.worktree_id }
          this.source = new NodeDocumentSource(this.client, root.worktree_id, true)
          return this.target.value
        }
        cursor = page.cursor ?? undefined
      } while (cursor)
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'git_required'
      )
        throw error
      let after: string | undefined
      for (;;) {
        const page = await this.client.listWorkspaces(this.identity.projectId, after)
        const root = page.find(
          (entry) =>
            entry.state === 'ready' &&
            (this.worktreeId ? entry.workspace_id === this.worktreeId : entry.kind === 'root')
        )
        if (root) {
          this.target.value = { ...this.identity, kind: 'workspace', id: root.workspace_id }
          this.source = new NodeDocumentSource(this.client, root.workspace_id)
          return this.target.value
        }
        if (page.length < 100) break
        const next = page.at(-1)?.workspace_id
        if (!next || next === after) break
        after = next
      }
    }
    throw new Error('The project root is unavailable')
  }
  private async fresh<T>(read: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await read()
      } catch (error) {
        if (
          attempt >= 2 ||
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 'stale_revision'
        )
          throw error
      }
    }
  }
  async list() {
    const controller = new AbortController()
    const timer = window.setTimeout(
      () =>
        controller.abort(
          new Error(
            'Request file discovery did not finish within 5 seconds. Check the node connection and narrow the project folder, then retry http_requests.'
          )
        ),
      5000
    )
    const signal = controller.signal
    try {
      const target = await untilAborted(this.ready(), signal)
      return await this.fresh(() => this.findFiles(target, signal))
    } finally {
      window.clearTimeout(timer)
      controller.abort(new Error('Request file discovery finished'))
    }
  }
  private async findFiles(target: PathTarget, signal: AbortSignal) {
    signal.throwIfAborted()
    const revision =
      target.kind === 'worktree'
        ? (await untilAborted(this.client.repository.observe({ worktree_id: target.id }), signal))
            .revision
        : undefined
    // Filename searches run on the node; unrelated directories cost no client round trips.
    // Include collection markers and environment files as well as request sources.
    const pages = await Promise.all(
      ['.http', '.rest', '.bru', 'bruno.json', 'http-client'].map((query) =>
        pathPages((cursor) => {
          signal.throwIfAborted()
          const options = {
            query,
            mode: 'filename' as const,
            case_sensitive: false,
            limit: 100,
            cursor,
          }
          return untilAborted(
            target.kind === 'worktree'
              ? this.client.repository.search({
                  ...options,
                  worktree_id: target.id,
                  revision,
                  scope: 'repository',
                })
              : this.client.nodePath.search({ ...options, workspace_id: target.id }),
            signal
          )
        })
      )
    )
    return [...new Set(pages.flatMap((page) => page.map((entry) => entry.path)))].filter(
      (path) =>
        !/(^|\/)(\.git|node_modules|\.abele)(\/|$)/.test(path) &&
        (/\.(http|rest|bru)$/i.test(path) ||
          /(^|\/)(bruno\.json|http-client(?:\.private)?\.env\.json)$/.test(path))
    )
  }
  async read(path: string) {
    await this.ready()
    const doc = await this.fresh(() => this.source.read(path))
    if (doc.text === undefined) throw new Error(`Cannot read ${path} as text`)
    return { text: doc.text, contentId: doc.contentId }
  }
  async write(path: string, base: { text: string; contentId: string | null }, text: string) {
    if (this.sensitiveText(path, base.text) || this.sensitiveText(path, text))
      return this.writeSensitive(path, base, text)
    await this.ready()
    const previous = await this.source.draft(path)
    if (previous && previous.status !== 'saved') {
      this.conflicts.set(path, previous.revision)
      throw new Error('Open the file to review its pending edit')
    }
    const draft = await this.source.edit(
      path,
      {
        ...base,
        size: new TextEncoder().encode(base.text).length,
        binary: false,
        large: false,
        tooLarge: false,
      },
      text,
      previous?.revision ?? null
    )
    try {
      const saved = await this.source.save(path, draft)
      if (saved?.status !== 'saved')
        throw new Error('Open the file to review its save conflict or pending outcome')
    } catch (error) {
      const retained = await this.source.draft(path)
      if (retained && retained.status !== 'saved') this.conflicts.set(path, retained.revision)
      throw error
    }
  }
  private sensitiveText(path: string, text: string) {
    if (/(^|\/)http-client(?:\.private)?\.env\.json$/i.test(path)) return true
    const parsed = parseRequestFile(path, text)
    if (
      parsed.vars.some(
        (v) => SECRET_NAME.test(v.key) && v.value && !/^\$\{abele_key:[^}]+\}$/.test(v.value)
      )
    )
      return true
    return parsed.requests.some(
      ({ doc }) =>
        doc.headers.some((h) => credential(h.key, h.value)) ||
        JSON.stringify(
          scrubSecrets({ collection: '', requests: [{ doc }], vars: [], leftOut: [] }).requests[0]
            .doc
        ) !== JSON.stringify(doc)
    )
  }
  /** The SDK's normal CAS/receipt flow, isolated from the persistent installation store. */
  writeSensitive(path: string, base: { text: string; contentId: string | null }, text: string) {
    const work = this.sensitiveWork.then(async () => {
      const target = await this.ready()
      const durable = await this.source.draft(path)
      if (durable && durable.status !== 'saved') throw new Error(t('requests.file.pendingEdit'))
      if (!this.transientClient) throw new Error(t('requests.file.sensitiveUnavailable'))
      const client = (this.sensitiveClient ??= this.transientClient())
      const source = (this.sensitiveSource ??= new NodeDocumentSource(
        client,
        target.id,
        target.kind === 'worktree'
      ))
      try {
        await client.connect()
        let previous = await source.draft(path)
        if (previous?.pending) {
          await source.check(path)
          throw new Error(t('requests.file.secretChecked'))
        }
        // An explicit retry replaces a settled local attempt with the freshly read baseline.
        // Unknown operations above retain their identity and are checked before any new edit.
        if (previous && previous.status !== 'saved') {
          await source.discard(path, previous.revision)
          previous = undefined
        }
        const draft = await source.edit(
          path,
          {
            ...base,
            size: new TextEncoder().encode(base.text).length,
            binary: false,
            large: false,
            tooLarge: false,
          },
          text,
          previous?.revision ?? null
        )
        const saved = await source.save(path, draft)
        if (saved?.status !== 'saved') throw new Error(t('requests.file.secretPending'))
        this.conflicts.delete(path)
      } catch (error) {
        const pending = await source.draft(path)
        if (pending && pending.status !== 'saved')
          this.conflicts.set(path, durable?.revision ?? null)
        throw error
      } finally {
        await client.disconnect()
      }
    })
    this.sensitiveWork = work.catch(() => {})
    return work
  }
  async resolved(path: string) {
    const revision = this.conflicts.get(path)
    if (!this.conflicts.has(path)) return false
    const draft = await this.source.draft(path)
    const resolved = draft
      ? draft.status === 'saved' && draft.revision !== revision
      : revision !== null
    if (resolved) this.conflicts.delete(path)
    return resolved
  }
  async conflict(path: string, base: { text: string; contentId: string | null }, text: string) {
    try {
      await this.write(path, base, text)
    } finally {
      const draft = await this.source.draft(path)
      if (draft && draft.status !== 'saved') this.conflicts.set(path, draft.revision)
      await this.open(path)
    }
  }
  async watch(changed: () => void) {
    return this.path.watch(await this.ready(), changed)
  }
  async open(path: string, line = 1) {
    const target = await this.ready()
    if (target.kind === 'workspace') {
      const { NodeFilesModel } = await import('@/node/NodeFilesModel')
      const { NodeService } = await import('@/node/NodeService')
      const { openNodeFiles } = await import('@/node/openFiles')
      openNodeFiles(
        new NodeFilesModel(this.client, this.identity.nodeId, target.id),
        NodeService.getInstance().connection(this.identity.registrationId),
        path,
        { start: line, end: line }
      )
      return
    }
    const { openNodeRepository } = await import('@/node/openRepository')
    await openNodeRepository(this.identity.registrationId, this.identity.projectId, target.id, {
      path,
      lines: { from: line, to: line },
      pane: 'tab',
    })
  }
}
