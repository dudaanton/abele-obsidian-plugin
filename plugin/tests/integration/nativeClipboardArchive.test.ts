// @vitest-environment node
import { it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  captureNativeClipboard,
  restoreNativeClipboard,
  sameNativeClipboard,
} from '../e2e/helpers/nativeClipboard'
it.runIf(process.platform === 'darwin')(
  'round trips every format/item through actual AppKit in an owned named pasteboard (not the global clipboard)',
  () => {
    const name = 'abele-clipboard-fixture-' + randomUUID(),
      original = JSON.stringify([
        [
          ['public.utf8-plain-text', Buffer.from('sample').toString('base64')],
          ['abele.sample.custom', Buffer.from([0, 255, 128]).toString('base64')],
        ],
        [['public.utf8-plain-text', Buffer.from('second sample item').toString('base64')]],
      ])
    try {
      restoreNativeClipboard(original, name)
      expect(sameNativeClipboard(original, captureNativeClipboard(name))).toBe(true)
    } finally {
      restoreNativeClipboard('[]', name)
    }
  }
)
