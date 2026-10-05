import { nativeGesture } from './nativeGesture'

export interface PreparedControl {
  x: number
  y: number
  hit: boolean
}

/** Runs in the host, never inside the browser job that measures the input. */
export async function stagedNativeControl<T>(ports: {
  prepare(): Promise<PreparedControl>
  tap(point: PreparedControl): Promise<{ ok: boolean }>
  measure(point: PreparedControl, acknowledgment: { ok: boolean }): Promise<T>
}): Promise<T> {
  const point = await ports.prepare()
  if (!point.hit || !Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new Error('Native control hit prerequisite failed')
  const acknowledgment = await nativeGesture(() => ports.tap(point))
  return ports.measure(point, acknowledgment)
}
