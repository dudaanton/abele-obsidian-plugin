/** Normalize only public frame dimensions; never include device identifiers/status payloads. */
export function nativeControlFrame(
  screen: number[] | { width: number; height: number } | undefined
): {
  width: number
  height: number
} {
  if (!screen) throw new Error('Native control frame is unavailable')
  const frame = Array.isArray(screen)
    ? { width: screen[0], height: screen[1] }
    : { width: screen.width, height: screen.height }
  if (
    !Number.isFinite(frame.width) ||
    !Number.isFinite(frame.height) ||
    frame.width <= 0 ||
    frame.height <= 0
  )
    throw new Error('Native control frame is unavailable')
  return frame
}
