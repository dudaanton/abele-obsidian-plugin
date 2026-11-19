import type { scrollCompletion } from './scrollCompletion'

/** A single native wheel step, shared with the serialized renderer probe. */
export async function wideWheelStep(
  el: HTMLElement,
  dispatch: () => Promise<unknown>,
  received: () => number,
  completion: typeof scrollCompletion,
  wait: (ms: number) => Promise<unknown> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
) {
  const receipt = received()
  const scroll = completion(el)
  try {
    await dispatch()
    scroll.releasing()
    for (let attempt = 0; received() <= receipt && attempt < 60; attempt++) await wait(16)
    if (received() <= receipt) throw Error('Wide wheel input was not received')
    await scroll.wait()
    // Let layout reflect the completed native scroll before comparing rectangles.
    await wait(16)
  } finally {
    scroll.stop()
  }
}
