# Synthetic image fixture

`sample-gradient.png` is a generated 48×32 RGB gradient: red is `x * 5`, green is
`y * 7`, and blue is `80`. It contains no photographed content or user metadata.
`sample-gradient.heic` is the same fabricated image encoded as HEIC with the platform image
encoder (`sips -s format heic sample-gradient.png --out sample-gradient.heic`). The browser
regression test converts it back to PNG and checks its dimensions and model input format.
