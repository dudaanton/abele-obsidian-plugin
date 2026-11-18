export interface DesktopCapture {
  width: number
  height: number
  imageWidth: number
  imageHeight: number
  mobile: boolean
  phoneClasses: boolean
  centered: boolean
}
export function desktopCaptureErrors(capture: DesktopCapture): string[] {
  const errors: string[] = []
  if (capture.width !== 1200 || capture.height !== 900) errors.push('viewport')
  if (capture.imageWidth !== 1200 || capture.imageHeight !== 900) errors.push('PNG dimensions')
  if (capture.mobile || capture.phoneClasses) errors.push('phone emulation')
  if (!capture.centered) errors.push('modal is not centered with desktop margins')
  return errors
}
export interface InspectionHost {
  snapshot(): { mobile: boolean; width: number; height: number }
  show(width: number, height: number, mobile: boolean): Promise<void>
}
export async function withDesktopInspection<T>(
  host: InspectionHost,
  work: () => Promise<T>
): Promise<T> {
  const original = host.snapshot()
  try {
    await host.show(1200, 900, false)
    return await work()
  } finally {
    await host.show(original.width, original.height, original.mobile)
  }
}
