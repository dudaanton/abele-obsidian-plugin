import type { LocalStorage } from '@/sync/ledgerId'
import type { RegistryHost } from './NodeRegistry'
import { sameStoredValue } from './storeDraft'
import { UiError, uiMessage } from '@/i18n/streamBErrors'

const KEY = 'abele-node-registry'

export function nodeRegistryStorage(local: LocalStorage): Pick<RegistryHost, 'read' | 'write'> {
  return {
    read: () => local.loadLocalStorage(KEY),
    write: (nodes) => {
      local.saveLocalStorage(KEY, nodes)
      // The host may swallow quota errors. Confirm persistence before admission or retirement.
      if (!sameStoredValue(local.loadLocalStorage(KEY), nodes)) {
        console.debug('[Abele node] Registry save did not persist')
        throw new UiError(uiMessage('streamBError.nodeRegistrySave'))
      }
    },
  }
}
