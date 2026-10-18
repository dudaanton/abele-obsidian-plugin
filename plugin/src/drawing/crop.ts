import { t } from '@/i18n'
/**
 * Cropping a picture: a frame over it, a shape the frame keeps, and how the picture is turned and
 * mirrored. The frame is kept in fractions of the picture as it is shown (turned and mirrored), so
 * it holds when the picture is drawn at any size; only saving turns it into pixels.
 */

/** A frame over the picture, each side a fraction of the shown picture's width or height. */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export type CropAspect = 'free' | 'original' | 'square' | '4:3' | '16:9'

export interface CropState {
  rect: CropRect
  aspect: CropAspect
  /** A 4:3 or 16:9 frame stood on its end: 3:4, 9:16. */
  upright: boolean
  /** Quarter turns to the left. */
  turns: 0 | 1 | 2 | 3
  /** Mirrored left to right. */
  flipped: boolean
}

export const CROP_ASPECTS: readonly { id: CropAspect; label: string; tooltip: string }[] = [
  {
    id: 'free',
    get label() {
      return t('streamC.f411a1fb62758b4c')
    },
    get tooltip() {
      return t('streamC.0d56a805d561372a')
    },
  },
  {
    id: 'original',
    get label() {
      return t('streamC.88d759ea02cef4b8')
    },
    get tooltip() {
      return t('streamC.08cc39d8159477ab')
    },
  },
  {
    id: 'square',
    get label() {
      return t('streamC.c11092bc0861591e')
    },
    get tooltip() {
      return t('streamC.c11092bc0861591e')
    },
  },
  {
    id: '4:3',
    label: '4:3',
    get tooltip() {
      return t('streamC.b7f2168099e9da3c')
    },
  },
  {
    id: '16:9',
    label: '16:9',
    get tooltip() {
      return t('streamC.ad941a358e482935')
    },
  },
]

/** The whole picture, nothing cut, not turned. */
export const wholePicture = (): CropState => ({
  rect: { x: 0, y: 0, w: 1, h: 1 },
  aspect: 'free',
  upright: false,
  turns: 0,
  flipped: false,
})

/** How a preset's button reads: 4:3 shows as 3:4 while stood on its end. */
export function aspectLabel(aspect: CropAspect, upright: boolean): string {
  if (upright && aspect === '4:3') return '3:4'
  if (upright && aspect === '16:9') return '9:16'
  return CROP_ASPECTS.find((a) => a.id === aspect)?.label ?? aspect
}

/** The shown picture's width over its height, after its turns. */
export const shownRatio = (width: number, height: number, turns: number) =>
  turns % 2 ? height / width : width / height

/** The same orientation for the preview, live ink and full resolution export. */
export function orientPicture(
  ctx: Pick<CanvasRenderingContext2D, 'translate' | 'scale' | 'rotate'>,
  width: number,
  height: number,
  state: Pick<CropState, 'turns' | 'flipped'>,
  centerX = width / 2,
  centerY = height / 2
): void {
  ctx.translate(centerX, centerY)
  ctx.scale(state.flipped ? -1 : 1, 1)
  ctx.rotate((-state.turns * Math.PI) / 2)
  ctx.translate(-width / 2, -height / 2)
}

/**
 * The frame's width over its height in pixels for a preset, or null when it may be any shape.
 * `picture` is the shown picture's own width over height.
 */
export function frameRatio(aspect: CropAspect, upright: boolean, picture: number): number | null {
  const preset: Record<CropAspect, number | null> = {
    free: null,
    original: picture,
    square: 1,
    '4:3': 4 / 3,
    '16:9': 16 / 9,
  }
  const ratio = preset[aspect]
  if (ratio === null) return null
  return upright && (aspect === '4:3' || aspect === '16:9') ? 1 / ratio : ratio
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * The largest frame of `ratio` (pixels, width over height) that fits on the picture, about the
 * middle of `rect` and moved in where it would cross an edge. `picture` is the shown picture's
 * width over height.
 */
export function fitRect(rect: CropRect, ratio: number, picture: number): CropRect {
  // In fractions a frame of `ratio` pixels is w / h = ratio / picture.
  const r = ratio / picture
  const w = r >= 1 ? 1 : r
  const h = r >= 1 ? 1 / r : 1
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h }
}

/** Which part of the frame is held: a corner, a side, or the whole frame. */
export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move'

/**
 * The frame after its `handle` moved by `dx`, `dy` (fractions of the shown picture), kept on the
 * picture, no smaller than `least` on a side, and of `ratio` when it has one.
 */
export function dragRect(
  start: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  ratio: number | null,
  picture: number,
  least = 0.05
): CropRect {
  if (handle === 'move')
    return {
      ...start,
      x: clamp(start.x + dx, 0, 1 - start.w),
      y: clamp(start.y + dy, 0, 1 - start.h),
    }
  let left = start.x
  let top = start.y
  let right = start.x + start.w
  let bottom = start.y + start.h
  if (handle.includes('w')) left = clamp(left + dx, 0, right - least)
  if (handle.includes('e')) right = clamp(right + dx, left + least, 1)
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - least)
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + least, 1)
  if (ratio === null) return { x: left, y: top, w: right - left, h: bottom - top }

  // A kept shape: the side that moved leads, the other follows from the far corner or side.
  const r = ratio / picture
  let w = right - left
  let h = bottom - top
  const sideOnly = handle.length === 1
  if (sideOnly ? handle === 'n' || handle === 's' : Math.abs(dy) > Math.abs(dx) * r) w = h * r
  else h = w / r
  // Never past the picture's edges from the anchored side.
  const roomW = handle.includes('w') ? start.x + start.w : 1 - start.x
  const roomH = handle.includes('n') ? start.y + start.h : 1 - start.y
  const shrink = Math.min(1, roomW / w, roomH / h)
  w *= shrink
  h *= shrink
  const x = handle.includes('w')
    ? start.x + start.w - w
    : handle.includes('e')
      ? start.x
      : clamp(start.x + start.w / 2 - w / 2, 0, 1 - w)
  const y = handle.includes('n')
    ? start.y + start.h - h
    : handle.includes('s')
      ? start.y
      : clamp(start.y + start.h / 2 - h / 2, 0, 1 - h)
  return { x, y, w, h }
}

/** The frame after the picture turns a quarter to the left: what was its right edge is its top. */
export const turnRectLeft = (r: CropRect): CropRect => ({
  x: r.y,
  y: 1 - r.x - r.w,
  w: r.h,
  h: r.w,
})

/** Keep the selected part and its aspect when the displayed picture turns left. */
export function turnPictureLeft(state: CropState): CropState {
  return {
    ...state,
    rect: turnRectLeft(state.rect),
    upright: state.aspect === '4:3' || state.aspect === '16:9' ? !state.upright : state.upright,
    // Mirroring reverses the direction of a turn in source coordinates.
    turns: ((state.turns + (state.flipped ? 3 : 1)) % 4) as CropState['turns'],
  }
}

/** The frame after the picture is mirrored left to right. */
export const flipRect = (r: CropRect): CropRect => ({ ...r, x: 1 - r.x - r.w })

/** Anything differs from the picture as it was. */
export function cropChanged(state: CropState): boolean {
  const r = state.rect
  const whole = r.x < 1e-3 && r.y < 1e-3 && r.w > 1 - 1e-3 && r.h > 1 - 1e-3
  return !whole || state.turns !== 0 || state.flipped
}

/** The frame's size in the saved picture's pixels, for saying it. */
export function croppedSize(state: CropState, width: number, height: number) {
  const shownW = state.turns % 2 ? height : width
  const shownH = state.turns % 2 ? width : height
  return {
    width: Math.max(1, Math.round(state.rect.w * shownW)),
    height: Math.max(1, Math.round(state.rect.h * shownH)),
  }
}
