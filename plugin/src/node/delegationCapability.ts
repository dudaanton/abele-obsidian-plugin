import { managerCapability } from './NodeManagerController'
import { UiError, uiMessage } from '@/i18n/streamBErrors'

export function requireGrantFreeDelegation(description: unknown): void {
  if (!managerCapability(description, 'delegation_without_grant'))
    throw new UiError(uiMessage('node.delegation.updateRequired'))
}
