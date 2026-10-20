import type { InjectionKey } from 'vue'
import type { NodeClient } from '@abele/node-client'
import type { LspLocation } from './NodeLspDocument'
/** Host adapter seam; also lets layout fixtures use an in-memory provider. */
export const LSP_CONNECTION: InjectionKey<{
  client: NodeClient
  connect(): Promise<void>
  navigate?(locations: LspLocation[]): void
}> = Symbol('node-lsp-connection')
