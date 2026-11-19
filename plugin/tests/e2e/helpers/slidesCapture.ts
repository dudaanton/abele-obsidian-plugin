/** Capture the current compositor surface rather than the native window's cached frame. */
export async function captureSlideViewport(cdp: {
  sendCommand(method: string, params: Record<string, unknown>): Promise<{ data: string }>
}): Promise<string> {
  return (
    await cdp.sendCommand('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    })
  ).data
}
