/** Observe state, rendered titles and geometry; never reposition the row being measured. */
export const TIMELINE_READY_PROBE = `
  const settleTimelineUI = async (measure, ready, wait) => {
    let last, stable = 0
    for (let i = 0; i < 150; i++) {
      const current = JSON.stringify(measure())
      stable = ready() && current === last ? stable + 1 : 0
      if (stable >= 5) return
      last = current
      await wait(100)
    }
    throw Error('timeline UI did not settle')
  }
`
