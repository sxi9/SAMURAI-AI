# MediaPipe hand tracking (vendored)

- `vision_bundle.mjs`, `wasm/vision_wasm_internal.{js,wasm}`: `@mediapipe/tasks-vision` 0.10.21 (Apache-2.0), SIMD build only (every current browser supports WASM SIMD).
- `hand_landmarker.task`: Google's hand landmarker model, float16 variant, from
  `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`

If the model file is missing (fresh clone without it), download that URL into this folder; `app/js/hud-gestures.js` loads everything from here, nothing is fetched from the internet at runtime.

Refresh with: `npm pack @mediapipe/tasks-vision@0.10.21`, then copy `vision_bundle.mjs` and the two `vision_wasm_internal.*` files.
