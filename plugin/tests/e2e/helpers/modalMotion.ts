/** Host sheets also animate through inline transforms, outside the Web Animations API. */
export function modalIsMoving(modal: HTMLElement): boolean {
  const container = modal.closest<HTMLElement>('.modal-container')
  return [modal, container].some((element) => {
    if (!element) return false
    const transform = element.style.transform
    if (transform && transform !== 'none') return true
    return element
      .getAnimations()
      .some(
        (animation) =>
          animation.effect?.getTiming().iterations !== Infinity &&
          (animation.pending || animation.playState === 'running')
      )
  })
}

export async function modalReady(modal: HTMLElement): Promise<void> {
  const deadline = Date.now() + 5000
  let previous = '',
    stable = 0
  do {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const r = modal.getBoundingClientRect()
    const geometry = JSON.stringify([r.left, r.top, r.width, r.height])
    stable = !modalIsMoving(modal) && geometry === previous ? stable + 1 : 0
    if (stable >= 3 && modal.isConnected) return
    previous = geometry
  } while (Date.now() < deadline)
  throw Error('Modal geometry did not settle: ' + modal.outerHTML.slice(0, 500))
}

export async function modalDetached(container: HTMLElement | null): Promise<void> {
  const deadline = Date.now() + 5000
  while (container?.isConnected) {
    if (Date.now() > deadline) throw Error('Modal backdrop did not detach')
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}

/** Injected into the app's document; descendants' looping status animations do not block it. */
export const modalMotion = `
  const modalIsMoving = ${modalIsMoving.toString()}
  const modalReady = ${modalReady.toString()}
  const modalDetached = ${modalDetached.toString()}
`
