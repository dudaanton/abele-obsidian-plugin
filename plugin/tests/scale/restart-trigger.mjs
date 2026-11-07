export async function triggerComparisonAtRestart(proxy, start, triggered) {
  return triggered(proxy, 'comparison', () => start({ passive: true }))
}

export async function prepareComparisonReindex(prepare, acquire) {
  const inventory = await prepare()
  return { inventory, trigger: await acquire() }
}

/** A closed comparison request cannot silently turn into an arbitrary later cut. */
export async function clickWithComparisonHold(
  proxy,
  trigger,
  acquire,
  click,
  { receiptGraceMs = 1000 } = {}
) {
  if (!proxy.active.has(trigger.id)) {
    proxy.release?.()
    const previousId = trigger.id
    proxy.record({ event: 'comparison-hold-rearm-start', previousId })
    trigger = await acquire()
    proxy.record({ event: 'comparison-hold-rearmed', previousId, id: trigger.id })
  }
  if (!proxy.active.has(trigger.id)) throw new Error('Comparison reindex hold expired before click')
  let closedAt
  let timer
  let expired
  const expiry = new Promise((_, reject) => {
    expired = reject
  })
  const onWire = (row) => {
    if (row.id !== trigger.id || !['close', 'finish'].includes(row.event) || closedAt !== undefined)
      return
    closedAt = row.at
    proxy.record({ event: 'comparison-hold-closed', id: trigger.id, closedAt })
    // The click itself may abort the request before its asynchronously written
    // receipt is read. Only a receipt timestamp preceding closure proves the cut.
    timer = setTimeout(() => {
      proxy.record({ event: 'comparison-hold-expired-before-click', id: trigger.id, closedAt })
      expired(new Error('Comparison reindex hold expired before click'))
    }, receiptGraceMs)
  }
  proxy.on('wire', onWire)
  try {
    const receipt = await Promise.race([Promise.resolve().then(click), expiry])
    if (!Number.isFinite(receipt?.at) || (closedAt !== undefined && receipt.at > closedAt))
      throw new Error('Comparison reindex hold expired before click')
    proxy.record({ event: 'comparison-hold-click', id: trigger.id, clickedAt: receipt.at })
    return receipt
  } finally {
    clearTimeout(timer)
    proxy.off('wire', onWire)
  }
}
