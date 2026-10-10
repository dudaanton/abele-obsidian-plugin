import type { RepositorySource, RepositoryTarget } from '@/repository/source'
import {
  nodeRepositoryToolsHost,
  type NodeRepositoryToolsHost,
  type NodeOpenRevision,
  type RepositoryEditProposal,
} from '@/ai/tools/node'
import { openNodeRepository, type OpenNodeRepositoryOptions } from './openRepository'
import { WORKING_TREE } from '@/repository/node'

interface ConnectionAuthority {
  client: { readonly connected: boolean }
  readonly authorizationGeneration: number
}
const controllers = new WeakMap<object, string>()
const workingRef = (ref: string) => (ref === 'WORKTREE' ? WORKING_TREE : ref)
/** Thin UI attachment. The tool host owns chat grants; an owner-opened tab grants none.
 * Cached selections require a connected, unchanged owner controller just like new reads.
 */
export function attachNodeRepositoryToolsTab(
  source: RepositorySource,
  connection: ConnectionAuthority,
  view: {
    target(): RepositoryTarget
    selection(): unknown
    proposeEdit?(proposal: RepositoryEditProposal, guard: () => void): Promise<string>
  },
  host: NodeRepositoryToolsHost = nodeRepositoryToolsHost,
  opener: (
    node: string,
    project: string,
    workspace: string,
    options?: OpenNodeRepositoryOptions
  ) => Promise<unknown> = openNodeRepository
): () => void {
  if (source.identity.provider !== 'node') throw new Error('Expected a node repository')
  const identity = source.identity
  if (!controllers.has(connection)) controllers.set(connection, crypto.randomUUID())
  const assertCurrent = () => {
    source.assertCurrent()
    if (!connection.client.connected)
      throw new Error('Node offline; reconnect before agent repository reads.')
  }
  const guarded = new Proxy(source, {
    get(target, key) {
      if (key === 'assertCurrent') return assertCurrent
      if (key === 'isCurrent') return target.isCurrent && connection.client.connected
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return host.attach({
    source: guarded,
    get authority() {
      return `${controllers.get(connection)}:${connection.authorizationGeneration}`
    },
    target: view.target,
    selection: view.selection,
    ...(view.proposeEdit
      ? {
          proposeEdit: async (proposal: RepositoryEditProposal, guard: () => void) => {
            assertCurrent()
            guard()
            const result = await view.proposeEdit!(proposal, () => {
              assertCurrent()
              guard()
            })
            assertCurrent()
            guard()
            return result
          },
        }
      : {}),
    open: async (node, project, workspace, path, revision?: NodeOpenRevision) => {
      assertCurrent()
      if (
        node !== identity.node ||
        project !== identity.project ||
        workspace !== identity.workspace
      )
        throw new Error('Repository navigation does not match the approved source.')
      const ref = workingRef(revision?.ref ?? WORKING_TREE)
      const options: OpenNodeRepositoryOptions = revision?.base
        ? { location: { kind: 'comparison', base: revision.base, head: ref, direct: true } }
        : revision?.commit && !path
          ? { location: { kind: 'commit', commit: revision.commit } }
          : {
              ...(path ? { path } : {}),
              revision: revision?.commit ?? ref,
              ...(revision?.lines
                ? { lines: { from: revision.lines.start, to: revision.lines.end } }
                : {}),
            }
      await opener(node, project, workspace, options)
      assertCurrent()
    },
  })
}
