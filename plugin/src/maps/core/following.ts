import type { Point } from './model'

/** The map owns this watch; navigating away always releases it. */
export class MapFollowing {
  active = false
  pending = false
  denied = false
  private watch: number | undefined
  private latest: Point | undefined
  private disposed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(
    private geo: Pick<Geolocation, 'watchPosition' | 'clearWatch'> | undefined,
    private move: (point: Point) => void,
    private changed: (error?: number) => void,
    private clock = { setTimeout, clearTimeout }
  ) {}
  toggle(): void {
    if (this.disposed) return
    if (this.active) {
      this.stop()
      return
    }
    if (!this.geo) {
      this.changed(2)
      return
    }
    this.active = true
    this.denied = false
    if (this.latest) this.move(this.latest)
    if (this.watch == null) {
      this.pending = true
      this.timer = this.clock.setTimeout(() => {
        this.pending = false
        this.changed(3)
      }, 15000)
      this.watch = this.geo.watchPosition(
        (position) => {
          if (this.disposed) return
          this.clock.clearTimeout(this.timer)
          this.pending = false
          this.latest = { lat: position.coords.latitude, lon: position.coords.longitude }
          if (this.active) this.move(this.latest)
          this.changed()
        },
        (error) => {
          if (this.disposed) return
          this.clock.clearTimeout(this.timer)
          this.pending = false
          if (error.code === 1) {
            this.stop()
            this.denied = true
          }
          this.changed(error.code)
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
      )
    }
    this.changed()
  }
  pan(): void {
    this.active = false
    this.changed()
  }
  private stop(): void {
    this.clock.clearTimeout(this.timer)
    this.timer = undefined
    if (this.watch != null) this.geo?.clearWatch(this.watch)
    this.watch = undefined
    this.active = this.pending = false
    this.changed()
  }
  dispose(): void {
    this.disposed = true
    this.stop()
  }
}
