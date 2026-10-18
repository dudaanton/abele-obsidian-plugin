import { UiError, uiMessage } from '@/i18n/streamBErrors'
import type { Support } from './model'

/** Exact inspected releases only. Version discovery must not guess newer API guarantees. */
export function schemaSupport(
  kind: string,
  version: string
): {
  draftCreate: Support
  notificationDone: Support
  blame: Support
  compareFiles: Support
} {
  if (!((kind === 'forgejo' && version === '11.0.0') || (kind === 'gitea' && version === '1.24.0')))
    throw new UiError(uiMessage('streamBError.3aef34f6c5'))
  return {
    draftCreate: {
      supported: false,
      reason: 'Draft creation is not defined by the pinned API schema.',
    },
    notificationDone: {
      supported: false,
      reason: 'The API has unread, read and pinned states, without a separate Done state.',
    },
    blame: { supported: false, reason: 'The pinned API has no blame endpoint.' },
    compareFiles:
      kind === 'forgejo'
        ? { supported: true }
        : {
            supported: false,
            reason: 'The compare response omits files; compare fixed trees and blobs instead.',
          },
  }
}
