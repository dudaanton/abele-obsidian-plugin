import { AbeleError } from '@abele/sync-sdk/protocol'
/** Whole-file fallback bound outside the explicit large-upload path. */
export const PHONE_FALLBACK_BYTES = 50 * 1024 * 1024
/** Hard ceiling for the single whole-file buffer required by mobile upload. */
export const MOBILE_WHOLE_READ_MAX = 200 * 1024 * 1024
/** Adapter capability shared through scoped filesystem proxies, without Obsidian dependencies. */
export const UPLOAD_READ = Symbol.for('abele.sync.open-upload-v1')
export const FINGERPRINT_UPLOAD = Symbol.for('abele.sync.fingerprint-upload-v1')

export class MobileWholeReadLimitError extends AbeleError {
  constructor(size: number) {
    super(
      'too_large',
      `This file is too large for a mobile whole-file read: ${size} bytes. The limit is 200 MiB. It stays on this device.`
    )
  }
}
