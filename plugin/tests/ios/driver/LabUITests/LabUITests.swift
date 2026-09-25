import XCTest

/// Drives Safari in the Simulator for the Abele iOS lab. Each test reads its gestures from
/// /tmp/abele-ios/gestures.json: a list of steps in points of the page, each one of
/// press (x, y, seconds), drag (x, y, seconds, toX, toY), tap (x, y), wait (seconds).
final class LabUITests: XCTestCase {
  func testRunGestures() throws {
    let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
    safari.activate()
    let data = try Data(contentsOf: URL(fileURLWithPath: "/tmp/abele-ios/gestures.json"))
    let steps = try JSONSerialization.jsonObject(with: data) as! [[String: Any]]
    let window = safari.windows.firstMatch
    let origin = window.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    func at(_ x: Any?, _ y: Any?) -> XCUICoordinate {
      origin.withOffset(CGVector(dx: (x as! NSNumber).doubleValue, dy: (y as! NSNumber).doubleValue))
    }
    for step in steps {
      let d = (step["s"] as? NSNumber)?.doubleValue ?? 0
      switch step["do"] as! String {
      case "tap": at(step["x"], step["y"]).tap()
      case "press": at(step["x"], step["y"]).press(forDuration: d)
      case "drag":
        let hold = (step["hold"] as? NSNumber)?.doubleValue ?? 0
        at(step["x"], step["y"]).press(forDuration: d, thenDragTo: at(step["tx"], step["ty"]),
          withVelocity: XCUIGestureVelocity((step["v"] as? NSNumber)?.doubleValue ?? 300),
          thenHoldForDuration: hold)
      case "wait": Thread.sleep(forTimeInterval: d)
      default: break
      }
    }
  }
}
