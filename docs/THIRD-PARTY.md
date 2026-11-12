# Third-party notices

Everything SAMURAI ships in `app/vendor/` is open source and vendored as plain files (no CDN, no build step).
Each folder keeps its own LICENSE file.

| Component | Version | Licence | Where |
|---|---|---|---|
| three.js (core, postprocessing, shaders, GLTFLoader, BufferGeometryUtils, SkeletonUtils) | r187 | MIT | `app/vendor/three/` |
| @pixiv/three-vrm (VRM 0.x / 1.0 loader, MToon, expressions, look-at, spring bones) | 3.5.5 | MIT, (c) 2019-2026 pixiv Inc. | `app/vendor/three-vrm/` |
| pinu-bot (parametric canvas robot face with emotions, by Paul Berry) | 0.3.0 | MIT | `app/vendor/pinu-bot/` |
| Leaflet | see folder | BSD-2-Clause | `app/vendor/leaflet/` |
| MediaPipe tasks (hands) | see folder | Apache-2.0 | `app/vendor/mediapipe/` |

Models (not code; each keeps the licence its author gave it):

| Model | Licence | Where |
|---|---|---|
| VRM1_Constraint_Twist_Sample.vrm, (c) 2022 pixiv Inc. | VRM Public License 1.0 (redistribution allowed, credit unnecessary) | `app/avatars/` (see `app/avatars/NOTICE.md`) |
| Vosk small English model | Apache-2.0 | downloaded into `models/` on first run |
