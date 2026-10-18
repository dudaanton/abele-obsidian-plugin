/** Let queued layout/canvas work paint before reading native window pixels. */
export function waitForPaint(win: Window): Promise<void> {
  return new Promise((resolve, reject) => {
    let frame: number
    const timer = win.setTimeout(() => {
      win.cancelAnimationFrame(frame)
      reject(new Error('Screenshot window is not painting'))
    }, 3000)
    frame = win.requestAnimationFrame(() => {
      frame = win.requestAnimationFrame(() => {
        win.clearTimeout(timer)
        resolve()
      })
    })
  })
}
