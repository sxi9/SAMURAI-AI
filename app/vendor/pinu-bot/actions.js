import { eye, pose } from "./stateDefinitions.js";
export const ACTION_NAMES = [
    "thinking",
    "listening",
    "sleeping",
    "offline",
    "bootUp",
    "glitch",
];
/**
 * Face-pose definitions for actions that replace the current expression.
 * "bootUp" and "glitch" are excluded here because they are driven as timed
 * overlay actions in robotFace.ts (see OVERLAY_ACTION_SYMBOLS) rather than as
 * standalone replacement pose definitions.
 */
export const ACTION_DEFINITIONS = {
    thinking: {
        pose: pose(eye(0.66, 0.18, 0.08, 0.02, -0.08, 0.94), eye(0.84, 0.08, -0.24, 0.16, -0.14, 0.96), { scale: 0.94, tilt: -0.08, brightness: 0.9 }, { openness: 0.03, curvature: -0.08, width: 0.68, tilt: 0.12, brightness: 0.88 }, { glow: 0.9, bob: 0.008, jitter: 0, distortion: 0, flicker: 0.01, scanline: 0.14 }),
        durationMs: 340,
        ease: "gentle",
        microBob: 0.007,
        microBobHz: 0.6,
        microSway: 0.07,
        blinkMinMs: 2600,
        blinkMaxMs: 5200,
        blinkDurationMs: 200,
    },
    listening: {
        pose: pose(eye(1, 0, -0.08, 0, -0.03, 1.16), eye(1, 0, 0.08, 0, -0.03, 1.16), { scale: 1.02, tilt: 0, brightness: 1.06 }, { openness: 0.015, curvature: 0.22, width: 0.84, tilt: 0, brightness: 1 }, { glow: 1.05, bob: 0.013, jitter: 0, distortion: 0, flicker: 0.014, scanline: 0.1 }),
        durationMs: 260,
        ease: "smooth",
        microBob: 0.01,
        microBobHz: 0.95,
        microSway: 0.05,
        blinkMinMs: 4200,
        blinkMaxMs: 7200,
        blinkDurationMs: 160,
    },
    sleeping: {
        pose: pose(eye(0.28, 0.28, 0.06, 0, 0.08, 0.56), eye(0.28, 0.28, -0.06, 0, 0.08, 0.56), { scale: 0.82, tilt: 0, brightness: 0.5 }, { openness: 0.01, curvature: -0.12, width: 0.7, tilt: 0, brightness: 0.54 }, { glow: 0.52, bob: 0.004, jitter: 0, distortion: 0, flicker: 0.002, scanline: 0.22 }),
        durationMs: 520,
        ease: "gentle",
        microBob: 0.005,
        microBobHz: 0.35,
        microSway: 0.015,
        blinkMinMs: 1800,
        blinkMaxMs: 3400,
        blinkDurationMs: 340,
    },
    offline: {
        pose: pose(eye(0.02, 0.3, 0, 0, 0, 0.18), eye(0.02, 0.3, 0, 0, 0, 0.18), { scale: 0.55, tilt: 0, brightness: 0.15 }, { openness: 0, curvature: 0, width: 0.5, tilt: 0, brightness: 0.16 }, { glow: 0.16, bob: 0, jitter: 0, distortion: 0, flicker: 0, scanline: 0.28 }),
        durationMs: 400,
        ease: "gentle",
        microBob: 0,
        microBobHz: 0.1,
        microSway: 0,
        blinkMinMs: 20000,
        blinkMaxMs: 30000,
        blinkDurationMs: 300,
    },
};
