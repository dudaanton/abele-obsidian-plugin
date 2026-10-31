exports.controlConfig = (config, controlReceipt) => ({ ...config, mode: 'control', controlReceipt })

// The phase starts with the old app stopped, even if the new startup never reaches idle.
exports.controlRestartBoundary = report => report.controlRestart?.devices?.[0]?.launchAt ??
  report.phases?.find(phase => phase.name === 'control restart')?.at

exports.captureControlError = function (receipt, state, save, capture) {
  if (!state.rows.some(row => row.status === 'error') &&
      !state.engines.some(engine => engine.state === 'error')) return false
  if (!receipt.errorSnapshot) {
    receipt.fatal = true
    receipt.errorAt = Date.now()
    receipt.errorSnapshot = JSON.parse(JSON.stringify(state))
    save()
    capture()
  }
  return true
}
