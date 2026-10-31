export async function enablePluginWhenReady(device, wait) {
  await wait('plugin enable after vault ready', async () => {
    try {
      return await device.evaluate('await app.plugins.setEnable(true);return true')
    } catch (error) {
      if (error.message === 'Vault CLI unavailable' && error.scaleCliFailure?.code === 124)
        return false
      throw error
    }
  }, 120000)
}
