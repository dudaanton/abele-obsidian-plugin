import type { Aspect } from './model'

export type Navigation = 'next' | 'previous' | 'first' | 'last' | number

export function navigate(current: number, action: Navigation, count: number): number {
  const next =
    typeof action === 'number'
      ? action
      : action === 'first'
        ? 0
        : action === 'last'
          ? count - 1
          : current + (action === 'next' ? 1 : -1)
  return Math.max(0, Math.min(Math.max(0, count - 1), Math.floor(next)))
}

export function slideForKey(key: string): Navigation | null {
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(key)) return 'next'
  if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(key)) return 'previous'
  if (key === 'Home') return 'first'
  if (key === 'End') return 'last'
  return null
}

export interface Point {
  x: number
  y: number
}

export function slideForGesture(start: Point, end: Point, width: number): Navigation | null {
  const dx = end.x - start.x,
    dy = end.y - start.y
  if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5) return dx < 0 ? 'next' : 'previous'
  if (Math.hypot(dx, dy) > 10 || width <= 0) return null
  return end.x < width / 3 ? 'previous' : end.x > (width * 2) / 3 ? 'next' : null
}

export function fitSlide(availableWidth: number, availableHeight: number, aspect: Aspect) {
  const width = aspect === '4:3' ? 960 : aspect === '9:16' ? 720 : 1280
  const height = aspect === '9:16' ? 1280 : 720
  const scale = Math.max(0, Math.min(availableWidth / width, availableHeight / height))
  return {
    width,
    height,
    scale,
    x: (availableWidth - width * scale) / 2,
    y: (availableHeight - height * scale) / 2,
  }
}
