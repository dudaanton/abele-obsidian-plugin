export async function enablePluginWhenReady(device, wait, { timeoutMs = 120000, evaluateTimeoutMs } = {}) {
  await wait('plugin enable after vault ready', async () => {
    try {
      return await device.evaluate('await app.plugins.setEnable(true);return true',
        ...(evaluateTimeoutMs === undefined ? [] : [{ timeoutMs: evaluateTimeoutMs }]))
    } catch (error) {
      if (error.message === 'Vault CLI unavailable' && error.scaleCliFailure?.code === 124)
        return false
      throw error
    }
  }, timeoutMs)
}
