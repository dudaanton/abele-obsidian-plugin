import type { InjectionKey } from 'vue'
import type { PathTarget } from './NodePathModel'
export interface NodeErrorContext {
  readonly registrationId?: string
  readonly target?: PathTarget
  refresh(): Promise<unknown> | void
}
export const NODE_ERROR_CONTEXT: InjectionKey<NodeErrorContext> = Symbol('node-error-context')
