import { driver } from './phone'

type Frame = [number, number, number, number]
export interface PhoneForegroundScene {
  screen: [number, number]
  frame: Frame
}
export interface PhoneBackgroundWitness {
  witness: 'springboard-scene-frame'
  foreground: PhoneForegroundScene
  frame: Frame | null
}

function sceneFrame(run: typeof driver, remaining: () => number): Frame | null {
  const value = remaining()
  if (value <= 0) throw Object.assign(new Error('Scene witness deadline'), { code: 'ETIMEDOUT' })
  const reply = JSON.parse(
    run(
      [
        'call',
        '/exists',
        JSON.stringify({ bundle: 'com.apple.springboard', label: 'Obsidian', timeout: 0.25 }),
      ],
      Math.ceil(value)
    )
  )
  if (typeof reply?.exists !== 'boolean') throw new Error('Invalid native scene reply')
  if (!reply.exists) return null
  const frame = reply.frame
  if (
    !Array.isArray(frame) ||
    frame.length !== 4 ||
    !frame.every((part: unknown) => typeof part === 'number' && Number.isFinite(part)) ||
    frame[2] < 0 ||
    frame[3] < 0
  )
    throw new Error('Invalid native scene frame')
  return frame as Frame
}

function isFullScreen(frame: Frame | null, screen: [number, number]): boolean {
  if (!frame) return false
  const [x, y, width, height] = frame
  const [screenWidth, screenHeight] = screen
  return (
    Math.abs(x) <= 4 &&
    Math.abs(y) <= 4 &&
    Math.abs(width - screenWidth) <= Math.max(4, screenWidth * 0.02) &&
    Math.abs(height - screenHeight) <= Math.max(4, screenHeight * 0.02)
  )
}

/** Record the full-screen SpringBoard scene before pressing Home. */
export function capturePhoneForegroundScene(run: typeof driver = driver): PhoneForegroundScene {
  const deadline = Date.now() + 20000
  const status = JSON.parse(run(['call', '/status', '{}'], Math.max(1, deadline - Date.now())))
  const screen = status?.screen
  if (
    !Array.isArray(screen) ||
    screen.length !== 2 ||
    !screen.every((part: unknown) => typeof part === 'number' && Number.isFinite(part) && part > 0)
  )
    throw new Error('Invalid native screen dimensions')
  const frame = sceneFrame(run, () => deadline - Date.now())
  if (!isFullScreen(frame, screen))
    throw new Error(
      `Phone foreground scene was not full-screen before Home; screen=${JSON.stringify(screen)}, frame=${JSON.stringify(frame)}`
    )
  return { screen: screen as [number, number], frame: frame! }
}

/** Native app state remains stale on some devices; the scene frame gives a
 * bounded, observable transition from foreground to background. */
export async function waitForPhoneBackground(options: {
  foreground: PhoneForegroundScene
  run?: typeof driver
  now?: () => number
  pause?: (ms: number) => Promise<void>
  report?: (frame: Frame | null) => void
}): Promise<PhoneBackgroundWitness> {
  const { foreground } = options
  if (!isFullScreen(foreground.frame, foreground.screen))
    throw new Error('Phone foreground scene was not full-screen before Home')
  const run = options.run ?? driver
  const now = options.now ?? Date.now
  const pause = options.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const report =
    options.report ??
    ((frame) =>
      console.info('[phone background scene frame]', { screen: foreground.screen, frame }))
  const deadline = now() + 20000
  let lastFrame: Frame | null | undefined
  const timeout = (cause?: unknown) =>
    new Error(
      `Timed out after 20000ms waiting for native background scene; foreground frame=${JSON.stringify(foreground.frame)}, screen=${JSON.stringify(foreground.screen)}, last frame=${JSON.stringify(lastFrame === undefined ? 'unobserved' : lastFrame)}`,
      { cause }
    )
  for (;;) {
    if (deadline - now() <= 0) throw timeout()
    let frame: Frame | null
    try {
      frame = sceneFrame(run, () => deadline - now())
    } catch (error) {
      if ((error as { code?: string })?.code !== 'ETIMEDOUT') throw error
      if (now() >= deadline) throw timeout(error)
      await pause(Math.min(250, deadline - now()))
      continue
    }
    if (now() > deadline) throw timeout()
    if (JSON.stringify(frame) !== JSON.stringify(lastFrame)) report(frame)
    lastFrame = frame
    if (!isFullScreen(frame, foreground.screen))
      return { witness: 'springboard-scene-frame', foreground, frame }
    if (now() >= deadline) throw timeout()
    await pause(Math.min(250, deadline - now()))
  }
}

/** An old runner fails explicitly; a fresh launch is not evidence of death. */
export function terminatePhone(run: typeof driver = driver): { killed: true; state: 1 } {
  if (!/\biphone kill\s+BUNDLE\b/.test(run(['--help'], 10000)))
    throw new Error('Phone driver kill capability is unavailable; update the driver')
  let result: { ok?: boolean; state?: number }
  try {
    result = JSON.parse(run(['kill', 'md.obsidian'], 30000))
  } catch (error) {
    throw new Error(
      'Phone device runner could not terminate the app; install the kill-capable device runner',
      { cause: error }
    )
  }
  if (result.ok !== true || result.state !== 1)
    throw new Error('Phone kill did not confirm notRunning')
  return { killed: true, state: 1 }
}
