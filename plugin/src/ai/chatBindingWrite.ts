import type { ChatMessage } from './types'
import type { SelectionBindingRecovery } from '@/selection/bindings'

export interface BindingState {
  messages: readonly ChatMessage[]
  recovery: readonly SelectionBindingRecovery[]
}
export interface BindingStateChange<T> {
  message?: ChatMessage
  recovery: SelectionBindingRecovery[]
  result: T
}
export interface ChatBindingStoragePort {
  bindingState(): BindingState
  changeBindings<T>(change: (state: BindingState) => Promise<BindingStateChange<T>>): Promise<T>
  inspectBindingWrite(operationId: string): Promise<boolean>
}
export class BindingWriteFailure extends Error {
  constructor(
    readonly uncertain: boolean,
    readonly cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : String(cause))
  }
}
