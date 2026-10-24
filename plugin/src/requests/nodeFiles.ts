import { shallowRef } from 'vue'
import type { NodeClient } from '@abele/node-client'
import { NodeDocumentSource } from '@/node/NodeFilesModel'
import { NodePathClientPort } from '@/node/NodePathClientPort'
import type { PathTarget } from '@/node/NodePathModel'
import type { RequestFilePort } from './FileCollections'

/** Reuses the node's independent watch leases and durable conditional document writes. */
export class NodeRequestFiles implements RequestFilePort {
  private target = shallowRef<PathTarget>()
  private source?: NodeDocumentSource
  private readonly path: NodePathClientPort
  constructor(
    private readonly client: NodeClient,
    private readonly identity: { nodeId: string; registrationId: string; projectId: string },
    private readonly connect: () => Promise<void>
  ) {
    this.path = new NodePathClientPort(client, identity)
  }
  matches(worktree: string) {
    return this.target.value?.id === worktree
  }
  async ready() {
    await this.connect()
    if (this.target.value) return this.target.value
    let cursor: string | undefined
    do {
      const page = await this.client.repository.worktrees({
        project_id: this.identity.projectId,
        cursor,
      })
      const root = page.entries.find((entry) => entry.kind === 'root')
      if (root) {
        this.target.value = { ...this.identity, kind: 'worktree', id: root.worktree_id }
        this.source = new NodeDocumentSource(this.client, root.worktree_id, true)
        return this.target.value
      }
      cursor = page.cursor ?? undefined
    } while (cursor)
    throw new Error('The project root is unavailable')
  }
  async list() {
    const target = await this.ready()
    const out: string[] = []
    const folders = ['']
    for (let at = 0; at < folders.length; at++) {
      let cursor: string | undefined
      do {
        const page = await this.path.tree(target, folders[at], cursor)
        for (const entry of page.entries) {
          if (entry.kind === 'folder') {
            if (!/(^|\/)(\.git|node_modules|\.abele)(\/|$)/.test(entry.path))
              folders.push(entry.path)
          } else out.push(entry.path)
        }
        cursor = page.cursor ?? undefined
      } while (cursor)
    }
    return out
  }
  async read(path: string) {
    await this.ready()
    const doc = await this.source.read(path)
    if (doc.text === undefined) throw new Error(`Cannot read ${path} as text`)
    return { text: doc.text, contentId: doc.contentId }
  }
  async write(path: string, base: { text: string; contentId: string | null }, text: string) {
    await this.ready()
    const previous = await this.source.draft(path)
    if (previous && previous.status !== 'saved')
      throw new Error('Open the file to review its pending edit')
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
    const saved = await this.source.save(path, draft)
    if (saved?.status !== 'saved')
      throw new Error('Open the file to review its save conflict or pending outcome')
  }
  async conflict(path: string, base: { text: string; contentId: string | null }, text: string) {
    try {
      await this.write(path, base, text)
    } finally {
      await this.open(path)
    }
  }
  async watch(changed: () => void) {
    return this.path.watch(await this.ready(), changed)
  }
  async open(path: string, line = 1) {
    const target = await this.ready()
    const { openNodeRepository } = await import('@/node/openRepository')
    await openNodeRepository(this.identity.registrationId, this.identity.projectId, target.id, {
      path,
      lines: { from: line, to: line },
      pane: 'tab',
    })
  }
}
