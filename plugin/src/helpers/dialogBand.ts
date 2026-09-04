/**
 * The band of a window a dialog may actually stand in, in the coordinates of the box it sits in.
 *
 * There are three worlds and no way to tell them apart from a stylesheet.
 *
 * On a desktop, and in `emulateMobile`, there is no on-screen keyboard and nothing shrinks: the
 * container is the window and the whole of it can be seen. On a phone the keyboard takes the
 * bottom of the screen — and *which* box loses that height is the platform's business. iOS
 * shrinks the page the dialog's container sits in, so a rule that also took Obsidian's
 * `--keyboard-height` off subtracted it twice: 1.17.2 came out as a sheet one header tall with
 * the thread and the composer clipped away, reported from a phone as «при нажатии на инпут на
 * модалке вообще ничего нет, она белая». And a `visualViewport` that never reports the keyboard
 * at all is the third: then the only thing that knows is Obsidian's own variable.
 *
 * So nothing is assumed and everything is measured: the container says how tall it is *now*,
 * `visualViewport` says which part of it can be seen, and `--keyboard-height` is asked how much
 * of the *window* is covered — with whatever the container has already lost taken off it, which
 * is what stops the double subtraction. The two answers are then combined by taking the
 * larger gap, because a dialog standing too high is readable and one standing too low is not.
 */
export interface DialogBand {
  /** How tall the dialog may be. */
  height: number
  /** How far its bottom edge must stay off the bottom of its container. */
  bottom: number
}

export interface DialogSpace {
  /** The box the dialog is positioned in, as it stands now. */
  container: number
  /** What `visualViewport` says can be seen, and where that band starts inside the container. */
  visible: number
  visibleTop: number
  /** Obsidian's `--keyboard-height`, which is measured against the whole window. */
  keyboard: number
  /** The window, for judging how much of the keyboard the container has already absorbed. */
  window: number
}

/**
 * Everything is clamped at zero: a dialog with a negative height is the blank sheet this
 * exists to prevent, and every browser has a moment during a resize when these disagree.
 */
export function dialogBand(space: DialogSpace): DialogBand {
  const container = Math.max(0, space.container)

  // What the visible band leaves below itself.
  const seen = Math.max(0, Math.min(container, space.visible))
  const fromViewport = Math.max(0, container - (Math.max(0, space.visibleTop) + seen))

  // What the keyboard covers that the container has not already given up.
  const absorbed = Math.max(0, space.window - container)
  const fromKeyboard = Math.max(0, Math.max(0, space.keyboard) - absorbed)

  const bottom = Math.min(container, Math.max(fromViewport, fromKeyboard))

  return { height: Math.min(seen, container - bottom), bottom }
}
