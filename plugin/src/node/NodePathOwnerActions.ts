import type { RepositoryRevision } from '@abele/node-protocol'
import type { PathTarget } from './NodePathModel'
/** Immutable resource context passed to the Obsidian chat's own scope/approval surface. */
export interface NodePathContext {
  target: Readonly<PathTarget>
  path?: string
  directory?: boolean
  revision?: RepositoryRevision
  contentId?: string | null
  text?: string
  selection?: string
  lines?: { start: number; end: number }
  side?: 'before' | 'after' | 'diff'
  commit?: string
}
export interface NodePathOwnerActions {
  grant(context: NodePathContext): Promise<void>
  ask(context: NodePathContext): Promise<void>
  add(context: NodePathContext): Promise<void>
}
let actions: NodePathOwnerActions | undefined
/** The chat adapter owns choosing the destination chat and recording its owner approval. */
export function installNodePathOwnerActions(value: NodePathOwnerActions): () => void {
  actions = value
  return () => {
    if (actions === value) actions = undefined
  }
}
export const nodePathOwnerActions = () => actions
export const freezeNodePathContext = (context: NodePathContext): NodePathContext =>
  Object.freeze({
    ...context,
    target: Object.freeze({ ...context.target }),
    ...(context.revision ? { revision: Object.freeze({ ...context.revision }) } : {}),
    ...(context.lines ? { lines: Object.freeze({ ...context.lines }) } : {}),
  })
