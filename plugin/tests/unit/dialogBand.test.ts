/**
 * How tall a phone dialog may be with a keyboard up, and how far off the bottom it must stand.
 *
 * Both numbers are measured rather than assumed, and this is why: the platform decides which
 * box loses the keyboard's height, and it is not the same everywhere. 1.17.2 took Obsidian's
 * `--keyboard-height` off a container iOS had *already* shrunk, subtracting it twice — the
 * sheet came out one header tall with the thread and the composer clipped away, and the phone
 * reported a white dialog with nothing in it.
 */
import { describe, it, expect } from 'vitest'
import { dialogBand } from '@/helpers/dialogBand'

/** A window with nothing covering it, which every case below varies from. */
const clear = { container: 896, visible: 896, visibleTop: 0, keyboard: 0, window: 896 }

describe('the band a dialog may stand in', () => {
  it('is the whole container when nothing is covering it', () => {
    expect(dialogBand(clear)).toEqual({ height: 896, bottom: 0 })
  })

  /** A desktop, and `emulateMobile`: the page keeps its height and the keyboard sits over it. */
  it('leaves the keyboard below it when the page kept its height', () => {
    expect(dialogBand({ ...clear, visible: 560, keyboard: 336 })).toEqual({
      height: 560,
      bottom: 336,
    })
  })

  /** iOS: the page under the dialog is already the band, so there is nothing left to take off. */
  it('takes nothing off twice when the page was shrunk for it', () => {
    expect(
      dialogBand({ container: 560, visible: 560, visibleTop: 0, keyboard: 336, window: 896 })
    ).toEqual({ height: 560, bottom: 0 })
  })

  /**
   * And the third: a viewport that never reports the keyboard at all. Obsidian's own variable
   * is the only thing that knows, and it is measured against the window.
   */
  it('falls back on what Obsidian says is covered', () => {
    expect(dialogBand({ ...clear, keyboard: 336 })).toEqual({ height: 560, bottom: 336 })
  })

  /** iOS again, scrolling a focused field up: the band moves without changing size. */
  it('follows the band when the platform scrolls it', () => {
    expect(dialogBand({ ...clear, visible: 560, visibleTop: 40 })).toEqual({
      height: 560,
      bottom: 296,
    })
  })

  it('never asks for more room than the container has', () => {
    expect(dialogBand({ ...clear, container: 560 })).toEqual({ height: 560, bottom: 0 })
  })

  /**
   * Mid-resize every browser has a moment where these disagree, and a dialog with a negative
   * height is the blank sheet this whole helper exists to prevent.
   */
  it('never answers with a negative length', () => {
    expect(dialogBand({ ...clear, container: 400, visible: 500, visibleTop: 300 })).toEqual({
      height: 400,
      bottom: 0,
    })
    expect(
      dialogBand({ container: 0, visible: 0, visibleTop: 0, keyboard: 336, window: 896 })
    ).toEqual({ height: 0, bottom: 0 })
    expect(dialogBand({ ...clear, visible: 560, visibleTop: -10, keyboard: 336 })).toEqual({
      height: 560,
      bottom: 336,
    })
  })
})
