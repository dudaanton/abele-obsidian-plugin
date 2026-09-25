#!/bin/bash
# Plays gestures in Safari in the Simulator and prints what the lab page logged.
#   tests/ios/play.sh <simulator id> '<steps as JSON>' [picture name]
# Steps, in points of the screen: {"do":"press","x","y","s"}, {"do":"drag","x","y","s","tx","ty",
# "v","hold"}, {"do":"tap","x","y"}, {"do":"wait","s"}. The driver is built once, into /tmp.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
D=$1
mkdir -p /tmp/abele-ios
echo "$2" > /tmp/abele-ios/gestures.json
if [ ! -d /tmp/abele-ios/dd/Build/Products ]; then
  xcodebuild build-for-testing -project "$HERE/driver/Lab.xcodeproj" -scheme LabUITests \
    -destination "id=$D" -derivedDataPath /tmp/abele-ios/dd > /tmp/abele-ios/build.log 2>&1
fi
: > /tmp/abele-ios/log.jsonl
xcodebuild test-without-building -project "$HERE/driver/Lab.xcodeproj" -scheme LabUITests \
  -destination "id=$D" -derivedDataPath /tmp/abele-ios/dd \
  -only-testing:LabUITests/LabUITests/testRunGestures > /tmp/abele-ios/test.log 2>&1 || true
grep -E "Test Case.*(passed|failed)" /tmp/abele-ios/test.log | head -1
sleep 1
[ -n "${3:-}" ] && xcrun simctl io "$D" screenshot "/tmp/abele-ios/$3.png" > /dev/null 2>&1
cat /tmp/abele-ios/log.jsonl
