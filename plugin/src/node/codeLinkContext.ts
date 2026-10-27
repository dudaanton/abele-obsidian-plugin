import type { InjectionKey } from 'vue'
export type CodeLinkOpener = ((resource: string) => void) & {
  active?: () => boolean
  canOpen?: (resource: string) => boolean
  context?: () => unknown
}
export const NODE_CODE_LINK_OPENER: InjectionKey<CodeLinkOpener> = Symbol('node-code-links')
