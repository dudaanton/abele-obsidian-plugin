/** Fixture positioning must settle before the test decides which row the reader is watching. */
export const TIMELINE_POSITION_PROBE = `
  const settleTimelinePosition = async (measure, position, frame, limit = 100) => {
    let steady = 0
    for (let i = 0; i < limit; i++) {
      if (Math.abs(measure()) > 0.5) {
        position()
        steady = 0
      }
      await frame()
      steady = Math.abs(measure()) <= 0.5 ? steady + 1 : 0
      if (steady >= 10) return
    }
    throw Error('timeline fixture row did not settle at the read position')
  }
`
