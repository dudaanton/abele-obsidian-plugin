function createIndexWaitCapture(receipt, save, screenshot) {
  let open = null
  let shot = null
  let finished = false
  receipt.indexWaitIntervals = []
  return {
    poll(activity, at = Date.now()) {
      if (finished) return
      const waiting = activity.some((row) => row.indexWaiting === true)
      if (waiting && open === null) {
        open = { beginAt: at, endAt: null }
        receipt.indexWaitIntervals.push(open)
        save()
        if (screenshot && shot === null) {
          shot = Promise.resolve()
            .then(screenshot)
            .then((saved) => {
              receipt.indexWaitScreenshot = saved === true
              save()
            })
            .catch((error) => {
              receipt.indexWaitScreenshotError = String(error?.message ?? error).slice(0, 300)
              save()
            })
        }
      } else if (!waiting && open !== null) {
        open.endAt = at
        open = null
        save()
      }
    },
    finish(at = Date.now()) {
      if (open !== null) open.endAt = at
      open = null
      finished = true
      save()
    },
    pending() {
      return shot ?? Promise.resolve()
    },
  }
}

module.exports = { createIndexWaitCapture }
