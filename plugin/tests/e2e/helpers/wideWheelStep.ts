import type { scrollCompletion } from './scrollCompletion'

/** A single native wheel step, shared with the serialized renderer probe. */
export async function wideWheelStep(
  el: HTMLElement,
  dispatch: () => Promise<unknown>,
  received: () => number,
  completion: typeof scrollCompletion
) {
  const receipt = received()
  const scroll = completion(el)
  try {
    await dispatch()
    scroll.releasing()
    for (let attempt = 0; received() <= receipt && attempt < 60; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 16))
    if (received() <= receipt) throw Error('Wide wheel input was not received')
    await scroll.wait()
  } finally {
    scroll.stop()
  }
}
