// A synthetic installer check cannot establish that the real host loaded the
// product. Only the renderer can publish this bounded, credential-free proof.
exports.startupReceipt = ({ at, marks, ledger, profilerAcknowledgedAt }) => ({
  schema: 1, at,
  profilerAcknowledgedAt: profilerAcknowledgedAt ?? null,
  onloadCompletedAt: marks.filter(mark => mark.name === 'abele:onload-end')
    .map(mark => mark.epoch).filter(Number.isFinite).at(-1) ?? null,
  onloadStartedAt: marks.filter(mark => mark.name === 'abele:onload-start')
    .map(mark => mark.epoch).filter(Number.isFinite).at(-1) ?? null,
  ledger: ledger ? { complete: ledger.complete, productRootsReady: ledger.productRootsReady,
    sequence: ledger.sequence, dropped: ledger.dropped,
    partialReasons: (ledger.partialReasons ?? []).slice(0, 20).map(reason => String(reason).slice(0, 200)) } : null,
})

exports.waitForLiveStartup = async ({ read, startedAt, now = Date.now, timeoutMs = 60000,
  delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) => {
  const deadline = startedAt + timeoutMs
  while (now() < deadline) {
    let proof
    try { proof = await read() } catch { /* Missing/partial files are retried within the launch deadline. */ }
    if (proof?.schema === 1 && Number.isFinite(proof.at) && proof.at >= startedAt && proof.at <= now() &&
      Number.isFinite(proof.onloadCompletedAt) && proof.onloadCompletedAt >= startedAt && proof.onloadCompletedAt <= proof.at &&
      Number.isFinite(proof.profilerAcknowledgedAt) && proof.profilerAcknowledgedAt >= startedAt && proof.profilerAcknowledgedAt <= proof.at)
      return proof
    await delay(Math.min(100, Math.max(0, deadline - now())))
  }
  throw new Error('Real app startup proof unavailable')
}
