import { clamp, drawPixelGlyph, ease, HEART_PATTERN, roundedRect } from "../drawUtils.js";
import { drawStandardGlyphEye } from "../standardFace.js";
import { eye, pose } from "../stateDefinitions.js";
import { STYLE_PRESETS } from "../styles.js";
const BUBO_BEAK_FILL = "#ffc247";
const BUBO_BEAK_GLOW = "rgba(255, 194, 71, 0.56)";
const BUBO_IRIS_FILL = "#ffcf5a";
const BUBO_IRIS_GLOW = "rgba(255, 207, 90, 0.42)";
const BUBO_PUPIL_FILL = "#140f18";
const BUBO_PUPIL_SHINE = "rgba(255, 248, 224, 0.92)";
const buboStyle = {
    ...STYLE_PRESETS.industrial,
    eyeWidth: 0.382,
    eyeHeight: 0.382,
    eyeY: -0.044,
    eyeGap: 0.126,
    browWidth: 0.18,
    browHeight: 0.016,
    browY: -0.2,
    noseWidth: 0.13,
    noseHeight: 0.094,
    noseY: 0.096,
    mouthWidth: 0.13,
    mouthHeight: 0.052,
    mouthY: 0.132,
    glowScale: 0.052,
};
const buboStylePresets = {
    classic: {
        ...buboStyle,
        panelInsetX: 0.06,
        panelInsetY: 0.078,
        panelRadius: 0.064,
        panelInnerPadding: 0.016,
        eyeWidth: 0.366,
        eyeHeight: 0.37,
        eyeY: -0.05,
        eyeGap: 0.128,
        browWidth: 0.174,
        browHeight: 0.015,
        browY: -0.208,
        noseWidth: 0.124,
        noseHeight: 0.092,
        noseY: 0.092,
        mouthWidth: 0.126,
        mouthHeight: 0.05,
        mouthY: 0.128,
        glowScale: 0.048,
    },
    soft: {
        ...buboStyle,
        panelInsetX: 0.056,
        panelInsetY: 0.072,
        panelRadius: 0.096,
        panelInnerPadding: 0.02,
        eyeWidth: 0.39,
        eyeHeight: 0.394,
        eyeY: -0.038,
        eyeGap: 0.122,
        browWidth: 0.17,
        browHeight: 0.017,
        browY: -0.214,
        noseWidth: 0.118,
        noseHeight: 0.088,
        noseY: 0.098,
        mouthWidth: 0.118,
        mouthHeight: 0.05,
        mouthY: 0.136,
        glowScale: 0.056,
    },
    minimal: {
        ...buboStyle,
        panelInsetX: 0.078,
        panelInsetY: 0.116,
        panelRadius: 0.05,
        panelInnerPadding: 0.014,
        eyeWidth: 0.334,
        eyeHeight: 0.338,
        eyeY: -0.058,
        eyeGap: 0.136,
        browWidth: 0.154,
        browHeight: 0.013,
        browY: -0.198,
        noseWidth: 0.11,
        noseHeight: 0.082,
        noseY: 0.09,
        mouthWidth: 0.106,
        mouthHeight: 0.044,
        mouthY: 0.126,
        glowScale: 0.038,
    },
    visor: {
        ...buboStyle,
        panelInsetX: 0.052,
        panelInsetY: 0.078,
        panelRadius: 0.084,
        panelInnerPadding: 0.015,
        eyeWidth: 0.428,
        eyeHeight: 0.336,
        eyeY: -0.052,
        eyeGap: 0.112,
        browWidth: 0.19,
        browHeight: 0.015,
        browY: -0.196,
        noseWidth: 0.12,
        noseHeight: 0.084,
        noseY: 0.1,
        mouthWidth: 0.122,
        mouthHeight: 0.046,
        mouthY: 0.138,
        glowScale: 0.058,
    },
    industrial: {
        ...buboStyle,
    },
};
function fillCenteredRect(ctx, centerX, centerY, width, height) {
    ctx.fillRect(centerX - width * 0.5, centerY - height * 0.5, width, height);
}
function fillRoundedSegment(ctx, centerX, centerY, width, height, rotation = 0) {
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);
    roundedRect(ctx, -width * 0.5, -height * 0.5, width, height, Math.min(width, height) * 0.5);
    ctx.fill();
    ctx.restore();
}
function fillFeatherSegment(ctx, centerX, centerY, width, height, rotation = 0) {
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);
    ctx.beginPath();
    ctx.moveTo(-halfWidth, 0);
    ctx.bezierCurveTo(-width * 0.18, -halfHeight, width * 0.18, -halfHeight, halfWidth, 0);
    ctx.bezierCurveTo(width * 0.12, halfHeight, -width * 0.24, halfHeight, -halfWidth, 0);
    ctx.fill();
    ctx.restore();
}
function fillEllipse(ctx, centerX, centerY, radiusX, radiusY) {
    traceEllipse(ctx, centerX, centerY, radiusX, radiusY);
    ctx.fill();
}
function traceEllipse(ctx, centerX, centerY, radiusX, radiusY) {
    const kappa = 0.5522847498;
    const offsetX = radiusX * kappa;
    const offsetY = radiusY * kappa;
    ctx.beginPath();
    ctx.moveTo(centerX - radiusX, centerY);
    ctx.bezierCurveTo(centerX - radiusX, centerY - offsetY, centerX - offsetX, centerY - radiusY, centerX, centerY - radiusY);
    ctx.bezierCurveTo(centerX + offsetX, centerY - radiusY, centerX + radiusX, centerY - offsetY, centerX + radiusX, centerY);
    ctx.bezierCurveTo(centerX + radiusX, centerY + offsetY, centerX + offsetX, centerY + radiusY, centerX, centerY + radiusY);
    ctx.bezierCurveTo(centerX - offsetX, centerY + radiusY, centerX - radiusX, centerY + offsetY, centerX - radiusX, centerY);
    ctx.closePath();
}
function traceBuboEyeDisc(ctx, centerX, centerY, radiusX, radiusY) {
    const outerX = radiusX * 0.94;
    const upperY = radiusY * 0.98;
    const lowerY = radiusY * 0.92;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - upperY);
    ctx.bezierCurveTo(centerX + radiusX * 0.54, centerY - radiusY, centerX + outerX, centerY - radiusY * 0.72, centerX + outerX, centerY - radiusY * 0.06);
    ctx.bezierCurveTo(centerX + outerX, centerY + radiusY * 0.44, centerX + radiusX * 0.58, centerY + lowerY, centerX, centerY + radiusY * 0.9);
    ctx.bezierCurveTo(centerX - radiusX * 0.58, centerY + lowerY, centerX - outerX, centerY + radiusY * 0.44, centerX - outerX, centerY - radiusY * 0.06);
    ctx.bezierCurveTo(centerX - outerX, centerY - radiusY * 0.72, centerX - radiusX * 0.54, centerY - radiusY, centerX, centerY - upperY);
    ctx.closePath();
}
function traceBuboSharpEyeSocket(ctx, centerX, centerY, radiusX, radiusY) {
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - radiusY);
    ctx.lineTo(centerX + radiusX * 0.28, centerY - radiusY * 0.98);
    ctx.lineTo(centerX + radiusX * 0.74, centerY - radiusY * 0.66);
    ctx.lineTo(centerX + radiusX * 1.02, centerY - radiusY * 0.12);
    ctx.lineTo(centerX + radiusX * 0.86, centerY + radiusY * 0.32);
    ctx.lineTo(centerX + radiusX * 0.38, centerY + radiusY * 0.88);
    ctx.lineTo(centerX, centerY + radiusY * 0.7);
    ctx.lineTo(centerX - radiusX * 0.38, centerY + radiusY * 0.88);
    ctx.lineTo(centerX - radiusX * 0.86, centerY + radiusY * 0.32);
    ctx.lineTo(centerX - radiusX * 1.02, centerY - radiusY * 0.12);
    ctx.lineTo(centerX - radiusX * 0.74, centerY - radiusY * 0.66);
    ctx.lineTo(centerX - radiusX * 0.28, centerY - radiusY * 0.98);
    ctx.closePath();
}
function traceBuboDropletEyeSocket(ctx, centerX, centerY, radiusX, radiusY) {
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - radiusY);
    ctx.bezierCurveTo(centerX + radiusX * 0.58, centerY - radiusY * 0.96, centerX + radiusX * 0.96, centerY - radiusY * 0.34, centerX + radiusX * 0.82, centerY + radiusY * 0.26);
    ctx.bezierCurveTo(centerX + radiusX * 0.64, centerY + radiusY * 0.72, centerX + radiusX * 0.26, centerY + radiusY * 1.04, centerX, centerY + radiusY * 1.16);
    ctx.bezierCurveTo(centerX - radiusX * 0.26, centerY + radiusY * 1.04, centerX - radiusX * 0.64, centerY + radiusY * 0.72, centerX - radiusX * 0.82, centerY + radiusY * 0.26);
    ctx.bezierCurveTo(centerX - radiusX * 0.96, centerY - radiusY * 0.34, centerX - radiusX * 0.58, centerY - radiusY * 0.96, centerX, centerY - radiusY);
    ctx.closePath();
}
function traceBuboBlockEyeSocket(ctx, centerX, centerY, radiusX, radiusY) {
    const insetX = radiusX * 0.12;
    const insetY = radiusY * 0.12;
    ctx.beginPath();
    ctx.moveTo(centerX - radiusX + insetX, centerY - radiusY);
    ctx.lineTo(centerX + radiusX - insetX, centerY - radiusY);
    ctx.lineTo(centerX + radiusX, centerY - radiusY + insetY);
    ctx.lineTo(centerX + radiusX, centerY + radiusY - insetY);
    ctx.lineTo(centerX + radiusX - insetX, centerY + radiusY);
    ctx.lineTo(centerX - radiusX + insetX, centerY + radiusY);
    ctx.lineTo(centerX - radiusX, centerY + radiusY - insetY);
    ctx.lineTo(centerX - radiusX, centerY - radiusY + insetY);
    ctx.closePath();
}
function traceBuboEyeSocket(ctx, shape, radiusX, radiusY) {
    if (shape === "block") {
        traceBuboBlockEyeSocket(ctx, 0, 0, radiusX, radiusY);
        return;
    }
    if (shape === "sharp") {
        traceBuboSharpEyeSocket(ctx, 0, 0, radiusX, radiusY);
        return;
    }
    if (shape === "droplet") {
        traceBuboDropletEyeSocket(ctx, 0, 0, radiusX, radiusY);
        return;
    }
    traceBuboEyeDisc(ctx, 0, 0, radiusX, radiusY);
}
function lerp(from, to, t) {
    return from + (to - from) * t;
}
function resolveEyeGeometry(shape) {
    switch (shape) {
        case "wide":
            return {
                sizeScale: 1.04,
                horizontalWidthScale: 0.2,
                horizontalHeightScale: 0.09,
                verticalWidthScale: 0.08,
                verticalHeightScale: 0.2,
                radiusScale: 0.37,
                diagonalXScale: 0.29,
                diagonalYScale: 0.25,
            };
        case "sharp":
            return {
                sizeScale: 1.02,
                horizontalWidthScale: 0.18,
                horizontalHeightScale: 0.08,
                verticalWidthScale: 0.08,
                verticalHeightScale: 0.19,
                radiusScale: 0.37,
                diagonalXScale: 0.31,
                diagonalYScale: 0.24,
            };
        case "sleepy":
            return {
                sizeScale: 0.98,
                horizontalWidthScale: 0.2,
                horizontalHeightScale: 0.08,
                verticalWidthScale: 0.08,
                verticalHeightScale: 0.16,
                radiusScale: 0.34,
                diagonalXScale: 0.28,
                diagonalYScale: 0.2,
            };
        case "droplet":
            return {
                sizeScale: 1,
                horizontalWidthScale: 0.18,
                horizontalHeightScale: 0.09,
                verticalWidthScale: 0.08,
                verticalHeightScale: 0.18,
                radiusScale: 0.37,
                diagonalXScale: 0.26,
                diagonalYScale: 0.28,
            };
        case "block":
            return {
                sizeScale: 1.02,
                horizontalWidthScale: 0.19,
                horizontalHeightScale: 0.09,
                verticalWidthScale: 0.08,
                verticalHeightScale: 0.19,
                radiusScale: 0.36,
                diagonalXScale: 0.28,
                diagonalYScale: 0.26,
            };
        default:
            return {
                sizeScale: 1,
                horizontalWidthScale: 0.18,
                horizontalHeightScale: 0.08,
                verticalWidthScale: 0.08,
                verticalHeightScale: 0.18,
                radiusScale: 0.36,
                diagonalXScale: 0.27,
                diagonalYScale: 0.26,
            };
    }
}
function resolveBuboEyeOffsets(shape, slotWidth, eyeWidthScale, eyeHeightScale) {
    const shapeShift = shape === "wide"
        ? 0.11
        : shape === "block"
            ? 0.08
            : shape === "sharp"
                ? 0.09
                : shape === "sleepy"
                    ? 0.05
                    : shape === "droplet"
                        ? 0.07
                        : 0;
    const scaleShift = Math.max(0, eyeWidthScale - 1) * 0.18;
    const tallness = Math.max(0, eyeHeightScale - eyeWidthScale);
    const narrowness = Math.max(0, 1 - eyeWidthScale);
    const tallDrop = eyeHeightScale >= 1.18 && eyeWidthScale <= 0.82 ? 0.03 : 0;
    const blockDrop = shape === "block" ? 0.05 : 0;
    const pillarDrop = shape === "block" && eyeHeightScale >= 1.35 ? 0.1 : 0;
    return {
        centerShiftX: slotWidth * (shapeShift + scaleShift),
        browDropY: slotWidth *
            Math.min(0.22, tallness * 0.19 + narrowness * 0.08 + tallDrop + blockDrop + pillarDrop),
    };
}
function resolveBuboBrowOpen(dc) {
    const emotionElapsed = Math.max(0, dc.elapsed - dc.emotionFromTime);
    if (dc.emotionName === "surprised") {
        const phase = Math.min(1, emotionElapsed / 260);
        return Math.sin(phase * Math.PI) * 0.12;
    }
    if (dc.emotionName === "excited") {
        return (Math.sin(emotionElapsed * 0.02) * 0.5 + 0.5) * 0.08;
    }
    return 0;
}
function resolveBeakGeometry(shape) {
    switch (shape) {
        case "pointed":
            return {
                topWidthScale: 0.86,
                topHeightScale: 0.17,
                bottomWidthScale: 0.24,
                bottomHeightScale: 0.11,
            };
        case "button":
            return {
                topWidthScale: 0.82,
                topHeightScale: 0.22,
                bottomWidthScale: 0.3,
                bottomHeightScale: 0.16,
            };
        case "gem":
            return {
                topWidthScale: 0.94,
                topHeightScale: 0.18,
                bottomWidthScale: 0.26,
                bottomHeightScale: 0.13,
            };
        default:
            return {
                topWidthScale: 1,
                topHeightScale: 0.18,
                bottomWidthScale: 0.22,
                bottomHeightScale: 0.12,
            };
    }
}
function resolveMiddleBarGeometry(shape) {
    switch (shape) {
        case "band":
            return {
                widthScale: 0.62,
                heightScale: 0.22,
            };
        case "block":
            return {
                widthScale: 0.5,
                heightScale: 0.32,
            };
        default:
            return {
                widthScale: 0.56,
                heightScale: 0.26,
            };
    }
}
function createBuboState(config) {
    const l = config.leftEye;
    const r = config.rightEye;
    return {
        pose: pose(eye(l?.openness ?? config.eyeOpenness, l?.squint ?? config.eyeSquint, l?.tilt ?? config.eyeTilt, l?.pupilX ?? 0, l?.pupilY ?? 0, l?.brightness ?? config.eyeBrightness), eye(r?.openness ?? config.eyeOpenness, r?.squint ?? config.eyeSquint, r?.tilt ?? -config.eyeTilt, r?.pupilX ?? 0, r?.pupilY ?? 0, r?.brightness ?? config.eyeBrightness), { scale: config.beakScale, tilt: config.beakTilt ?? 0, brightness: config.beakBrightness }, {
            openness: config.middleBarOpenness,
            curvature: config.mouthCurvature ?? 0,
            width: config.middleBarWidth,
            tilt: config.mouthTilt ?? 0,
            brightness: config.beakBrightness,
        }, {
            glow: config.glow,
            bob: config.bob,
            jitter: config.jitter ?? 0,
            distortion: config.distortion ?? 0,
            flicker: config.flicker,
            scanline: config.scanline,
        }),
        durationMs: config.durationMs,
        ease: config.ease,
        microBob: config.microBob,
        microBobHz: config.microBobHz,
        microSway: config.microSway,
        blinkMinMs: config.blinkMinMs,
        blinkMaxMs: config.blinkMaxMs,
        blinkDurationMs: config.blinkDurationMs,
    };
}
function applySegmentStyle(ctx, fill, glow, brightness, blur) {
    ctx.fillStyle = fill;
    ctx.shadowColor = glow;
    ctx.shadowBlur = blur;
    ctx.globalAlpha *= brightness;
}
function resolveEyeFill(theme) {
    return theme.foreground;
}
const buboEmotions = {
    neutral: createBuboState({
        eyeOpenness: 0.88,
        eyeSquint: 0.06,
        eyeTilt: 0.02,
        eyeBrightness: 1.08,
        beakScale: 1,
        beakBrightness: 1,
        middleBarOpenness: 0.12,
        middleBarWidth: 0.88,
        glow: 1.08,
        bob: 0.008,
        flicker: 0.014,
        scanline: 0.16,
        durationMs: 240,
        ease: "smooth",
        microBob: 0.008,
        microBobHz: 0.72,
        microSway: 0.018,
        blinkMinMs: 3400,
        blinkMaxMs: 6200,
        blinkDurationMs: 170,
    }),
    happy: createBuboState({
        eyeOpenness: 0.78,
        eyeSquint: 0.16,
        eyeTilt: 0.04,
        eyeBrightness: 1.16,
        beakScale: 1.02,
        beakBrightness: 1.08,
        middleBarOpenness: 0.24,
        middleBarWidth: 0.96,
        glow: 1.18,
        bob: 0.016,
        flicker: 0.022,
        scanline: 0.12,
        durationMs: 220,
        ease: "smooth",
        microBob: 0.014,
        microBobHz: 1.4,
        microSway: 0.026,
        blinkMinMs: 3800,
        blinkMaxMs: 7200,
        blinkDurationMs: 160,
    }),
    love: createBuboState({
        eyeOpenness: 0.82,
        eyeSquint: 0.06,
        eyeTilt: -0.35,
        eyeBrightness: 1.3,
        beakScale: 1.01,
        beakBrightness: 1.06,
        middleBarOpenness: 0.2,
        middleBarWidth: 0.8,
        glow: 1.2,
        bob: 0.014,
        flicker: 0.018,
        scanline: 0.11,
        durationMs: 240,
        ease: "smooth",
        microBob: 0.014,
        microBobHz: 1.15,
        microSway: 0.022,
        blinkMinMs: 4200,
        blinkMaxMs: 7600,
        blinkDurationMs: 170,
    }),
    sad: createBuboState({
        eyeOpenness: 0.4,
        eyeSquint: 0.26,
        eyeTilt: -0.24,
        eyeBrightness: 1.04,
        beakScale: 0.94,
        beakBrightness: 1,
        middleBarOpenness: 0.1,
        middleBarWidth: 0.74,
        mouthCurvature: -0.72,
        glow: 1.02,
        bob: 0.005,
        flicker: 0.008,
        scanline: 0.2,
        durationMs: 360,
        ease: "gentle",
        microBob: 0.005,
        microBobHz: 0.4,
        microSway: 0.014,
        blinkMinMs: 2400,
        blinkMaxMs: 4200,
        blinkDurationMs: 240,
    }),
    angry: createBuboState({
        eyeOpenness: 0.52,
        eyeSquint: 0.58,
        eyeTilt: 0.26,
        eyeBrightness: 1.14,
        beakScale: 1.02,
        beakBrightness: 1.1,
        middleBarOpenness: 0.06,
        middleBarWidth: 0.9,
        glow: 1.16,
        bob: 0.01,
        flicker: 0.08,
        scanline: 0.18,
        durationMs: 180,
        ease: "snap",
        microBob: 0.009,
        microBobHz: 1.9,
        microSway: 0.03,
        blinkMinMs: 5000,
        blinkMaxMs: 7600,
        blinkDurationMs: 130,
        jitter: 0.003,
        distortion: 0.018,
    }),
    surprised: createBuboState({
        eyeOpenness: 1,
        eyeSquint: 0,
        eyeTilt: 0,
        eyeBrightness: 1.22,
        beakScale: 1.08,
        beakBrightness: 1.14,
        middleBarOpenness: 0.82,
        middleBarWidth: 0.62,
        glow: 1.24,
        bob: 0.014,
        flicker: 0.024,
        scanline: 0.08,
        durationMs: 150,
        ease: "snap",
        microBob: 0.014,
        microBobHz: 1.35,
        microSway: 0.018,
        blinkMinMs: 9000,
        blinkMaxMs: 16000,
        blinkDurationMs: 130,
    }),
    confused: createBuboState({
        // Owl head-cock — both eyes tilted the same direction
        eyeOpenness: 0.72,
        eyeSquint: 0.16,
        eyeTilt: 0,
        eyeBrightness: 0.96,
        leftEye: { tilt: -0.32, pupilX: -0.04, pupilY: 0.02 },
        rightEye: { tilt: -0.32, pupilX: 0.04, pupilY: -0.02 },
        beakScale: 0.88,
        beakBrightness: 0.82,
        beakTilt: -0.4,
        middleBarOpenness: 0.06,
        middleBarWidth: 0.62,
        mouthCurvature: -0.38,
        mouthTilt: -0.42,
        glow: 0.94,
        bob: 0.008,
        flicker: 0.022,
        scanline: 0.18,
        durationMs: 320,
        ease: "smooth",
        microBob: 0.006,
        microBobHz: 0.6,
        microSway: 0.05,
        blinkMinMs: 2800,
        blinkMaxMs: 5000,
        blinkDurationMs: 190,
    }),
    excited: createBuboState({
        eyeOpenness: 0.98,
        eyeSquint: 0.04,
        eyeTilt: 0.02,
        eyeBrightness: 1.26,
        beakScale: 1.05,
        beakBrightness: 1.14,
        middleBarOpenness: 0.38,
        middleBarWidth: 1,
        glow: 1.3,
        bob: 0.02,
        flicker: 0.028,
        scanline: 0.1,
        durationMs: 160,
        ease: "snap",
        microBob: 0.018,
        microBobHz: 2.2,
        microSway: 0.032,
        blinkMinMs: 4200,
        blinkMaxMs: 7600,
        blinkDurationMs: 150,
        jitter: 0.001,
    }),
};
const buboActions = {
    thinking: createBuboState({
        // Eyes squashed via squint, left brow raised
        eyeOpenness: 0.62,
        eyeSquint: 0.7,
        eyeTilt: 0,
        eyeBrightness: 0.9,
        leftEye: { tilt: -0.4, pupilX: -0.06, pupilY: -0.1 },
        rightEye: { tilt: 0.1, pupilX: 0.06, pupilY: -0.1 },
        beakScale: 0.92,
        beakBrightness: 0.8,
        middleBarOpenness: 0.03,
        middleBarWidth: 0.58,
        mouthCurvature: -0.1,
        glow: 0.82,
        bob: 0.004,
        flicker: 0.012,
        scanline: 0.22,
        durationMs: 340,
        ease: "gentle",
        microBob: 0.004,
        microBobHz: 0.4,
        microSway: 0.012,
        blinkMinMs: 3000,
        blinkMaxMs: 5400,
        blinkDurationMs: 240,
    }),
    listening: createBuboState({
        // Wide and alert, slight head cock — attentive owl
        eyeOpenness: 0.96,
        eyeSquint: 0.02,
        eyeTilt: 0,
        eyeBrightness: 1.22,
        leftEye: { tilt: -0.16, pupilX: 0.06, pupilY: -0.02 },
        rightEye: { tilt: -0.16, pupilX: 0.06, pupilY: -0.02 },
        beakScale: 1.04,
        beakBrightness: 1.1,
        beakTilt: -0.18,
        middleBarOpenness: 0.06,
        middleBarWidth: 0.78,
        mouthTilt: -0.2,
        glow: 1.16,
        bob: 0.014,
        flicker: 0.008,
        scanline: 0.08,
        durationMs: 220,
        ease: "smooth",
        microBob: 0.01,
        microBobHz: 1.1,
        microSway: 0.035,
        blinkMinMs: 5000,
        blinkMaxMs: 8200,
        blinkDurationMs: 140,
    }),
    sleeping: createBuboState({
        eyeOpenness: 0.12,
        eyeSquint: 0.28,
        eyeTilt: 0.02,
        eyeBrightness: 0.54,
        beakScale: 0.84,
        beakBrightness: 0.58,
        middleBarOpenness: 0.04,
        middleBarWidth: 0.68,
        glow: 0.54,
        bob: 0.004,
        flicker: 0.004,
        scanline: 0.24,
        durationMs: 480,
        ease: "gentle",
        microBob: 0.004,
        microBobHz: 0.34,
        microSway: 0.012,
        blinkMinMs: 1800,
        blinkMaxMs: 3200,
        blinkDurationMs: 320,
    }),
    offline: createBuboState({
        eyeOpenness: 0.04,
        eyeSquint: 0.32,
        eyeTilt: 0,
        eyeBrightness: 0.2,
        beakScale: 0.72,
        beakBrightness: 0.28,
        middleBarOpenness: 0,
        middleBarWidth: 0.52,
        glow: 0.18,
        bob: 0,
        flicker: 0,
        scanline: 0.28,
        durationMs: 380,
        ease: "gentle",
        microBob: 0,
        microBobHz: 0.1,
        microSway: 0,
        blinkMinMs: 20000,
        blinkMaxMs: 30000,
        blinkDurationMs: 300,
    }),
};
function drawBuboEye(dc, params) {
    const { ctx, theme } = dc;
    const eyeShape = params.parts.eyeShape ?? "soft";
    const blockShape = eyeShape === "block";
    const sharpShape = eyeShape === "sharp";
    const sleepyShape = eyeShape === "sleepy";
    const dropletShape = eyeShape === "droplet";
    if (eyeShape !== "soft" &&
        eyeShape !== "wide" &&
        eyeShape !== "block" &&
        eyeShape !== "sharp" &&
        eyeShape !== "sleepy" &&
        eyeShape !== "droplet") {
        const openness = clamp(params.pose.openness, 0.01, 1);
        const squint = clamp(params.pose.squint, 0, 1);
        const eyeWidthScale = clamp(params.parts.eyeWidthScale, 0.5, 1.8);
        const eyeHeightScale = clamp(params.parts.eyeHeightScale, 0.5, 1.8);
        const w = params.width * eyeWidthScale;
        const h = params.height * eyeHeightScale;
        const brightness = clamp(params.pose.brightness, 0.18, 1.8);
        ctx.save();
        ctx.translate(params.centerX, params.centerY);
        ctx.rotate(params.pose.tilt * 0.4);
        ctx.strokeStyle = theme.foreground;
        ctx.fillStyle = theme.foreground;
        ctx.shadowColor = theme.glow;
        ctx.shadowBlur = Math.min(w, h) * 0.2;
        ctx.globalAlpha *= brightness;
        drawStandardGlyphEye(ctx, eyeShape, w, h, params.side, openness, squint, {
            lineWidthFloor: 2,
            sharpLineScale: 0.14,
            sleepyLineScale: 0.16,
        });
        ctx.restore();
        return;
    }
    const reducedDetail = dc.emotionName === "angry";
    const geometry = resolveEyeGeometry(eyeShape);
    const eyeWidthScale = clamp(params.parts.eyeWidthScale, 0.65, 1.6);
    const eyeHeightScale = clamp(params.parts.eyeHeightScale, 0.55, 1.8);
    const classicSoftShape = eyeShape === "soft" &&
        Math.abs(eyeWidthScale - 1) < 0.06 &&
        Math.abs(eyeHeightScale - 1) < 0.06;
    const shapeWidthScale = eyeShape === "wide"
        ? 0.92
        : blockShape
            ? 0.95
            : sharpShape
                ? 0.93
                : sleepyShape
                    ? 0.94
                    : dropletShape
                        ? 0.97
                        : 1;
    const classicSizeScale = (eyeWidthScale + eyeHeightScale) * 0.5 * geometry.sizeScale;
    const eyeBaseWidth = classicSoftShape
        ? Math.min(params.width, params.height) * classicSizeScale
        : params.width * eyeWidthScale * geometry.sizeScale * shapeWidthScale;
    const eyeBaseHeight = classicSoftShape
        ? Math.min(params.width, params.height) * classicSizeScale
        : params.height * eyeHeightScale * geometry.sizeScale;
    const eyeDiameter = classicSoftShape
        ? Math.min(params.width, params.height) * classicSizeScale
        : (eyeBaseWidth + eyeBaseHeight) * 0.5;
    const { centerShiftX } = resolveBuboEyeOffsets(eyeShape, params.width, eyeWidthScale, eyeHeightScale);
    const blinkAmount = clamp(1 - params.pose.openness, 0, 1);
    const brightness = clamp(params.pose.brightness, 0.18, 1.8);
    const squint = clamp(params.pose.squint, 0, 1);
    const horizontalWidth = Math.max(8, eyeBaseWidth * geometry.horizontalWidthScale);
    const horizontalHeight = Math.max(5, eyeBaseHeight * geometry.horizontalHeightScale);
    const verticalWidth = Math.max(5, eyeBaseWidth * geometry.verticalWidthScale);
    const verticalHeight = Math.max(8, eyeBaseHeight * geometry.verticalHeightScale);
    const lineHeight = Math.max(4, horizontalHeight * 0.8);
    const radiusX = eyeBaseWidth * geometry.radiusScale;
    const radiusY = eyeBaseHeight * geometry.radiusScale;
    const segmentHeight = Math.max(4, horizontalHeight * 0.72);
    const topWidth = horizontalWidth * 1.28;
    const sideWidth = verticalHeight * 0.76;
    const sideHeight = verticalWidth * 1.46;
    const diagonalWidth = horizontalWidth * 0.72;
    const diagonalHeight = segmentHeight * 0.72;
    const featherBias = lerp(0.12, 0.24, squint * 0.55 + (dc.emotionName === "angry" ? 0.16 : 0));
    const hoodWidth = topWidth *
        (1.12 + featherBias * 0.2) *
        (sharpShape ? 0.94 : dropletShape ? 0.88 : sleepyShape ? 1.02 : 1);
    const hoodHeight = segmentHeight *
        (0.86 + featherBias * 0.18) *
        (sleepyShape ? 1.2 : sharpShape ? 0.76 : dropletShape ? 0.9 : 0.78);
    const hoodY = -radiusY * (0.92 + featherBias * 0.05) +
        (sleepyShape
            ? radiusY * 0.34
            : dropletShape
                ? -radiusY * 0.08
                : sharpShape
                    ? -radiusY * 0.04
                    : 0);
    const shoulderX = radiusX * 0.68;
    const shoulderY = -radiusY * (0.44 + featherBias * 0.06) +
        (sleepyShape ? radiusY * 0.08 : sharpShape ? -radiusY * 0.04 : 0);
    const shoulderWidth = diagonalWidth * (0.92 + featherBias * 0.1) * (sharpShape ? 1.1 : 1);
    const shoulderHeight = diagonalHeight * (0.74 + featherBias * 0.06) * (sleepyShape ? 0.82 : 1);
    const innerHookX = -params.side * radiusX * 0.48;
    const innerHookY = -radiusY * (0.24 + featherBias * 0.12) +
        (sleepyShape ? radiusY * 0.06 : sharpShape ? -radiusY * 0.04 : 0);
    const innerHookWidth = diagonalWidth * (1 + featherBias * 0.12) * (sharpShape ? 1.08 : 1);
    const innerHookHeight = diagonalHeight * (0.84 + featherBias * 0.08) * (sleepyShape ? 0.78 : 1);
    const outerWingX = params.side * radiusX * 1.02;
    const outerWingY = -radiusY * (0.68 + featherBias * 0.06) +
        (sleepyShape ? radiusY * 0.05 : sharpShape ? -radiusY * 0.08 : 0);
    const outerWingWidth = diagonalWidth * (0.82 + featherBias * 0.08) * (sharpShape ? 1.16 : 1);
    const outerWingHeight = diagonalHeight * (0.5 + featherBias * 0.04) * (sleepyShape ? 0.72 : 1);
    const sideSweepX = radiusX * 0.98;
    const sideSweepY = radiusY * 0.04;
    const sideSweepWidth = sideWidth * (1.02 - featherBias * 0.02) * (sharpShape ? 0.94 : 1);
    const sideSweepHeight = sideHeight * (1.18 - featherBias * 0.02) * (sleepyShape ? 0.88 : dropletShape ? 1.08 : 1);
    const cheekX = radiusX * 0.74;
    const cheekY = radiusY * (0.72 - featherBias * 0.06) + (dropletShape ? radiusY * 0.08 : 0);
    const cheekWidth = diagonalWidth * (1 - featherBias * 0.04);
    const cheekHeight = diagonalHeight * (0.84 - featherBias * 0.04) * (sleepyShape ? 0.82 : 1);
    const innerCheekX = -params.side * radiusX * 0.42;
    const innerCheekY = radiusY * (0.56 - featherBias * 0.04) + (dropletShape ? radiusY * 0.06 : 0);
    const innerCheekWidth = diagonalWidth * (0.82 - featherBias * 0.04);
    const innerCheekHeight = diagonalHeight * (0.62 - featherBias * 0.04) * (sleepyShape ? 0.82 : 1);
    const chinWidth = topWidth *
        (blockShape ? 0.92 : 0.7 - featherBias * 0.04) *
        (sharpShape ? 0.82 : dropletShape ? 0.56 : 1);
    const chinHeight = segmentHeight * (0.48 - featherBias * 0.04) * (dropletShape ? 0.72 : sleepyShape ? 0.82 : 1);
    const chinY = radiusY * (0.9 - featherBias * 0.04) + (dropletShape ? radiusY * 0.2 : 0);
    const socketRadiusX = radiusX * (blockShape ? 0.96 : sharpShape ? 1.08 : dropletShape ? 0.9 : 1.02);
    const socketRadiusY = radiusY *
        lerp(1.04, 0.9, blinkAmount) *
        lerp(1, 0.52, squint) *
        (blockShape ? 0.94 : sleepyShape ? 0.72 : dropletShape ? 1.12 : sharpShape ? 0.96 : 1);
    const pupilScale = clamp(0.42 + params.pose.openness * 0.58, 0, 1);
    const pupilX = clamp(params.pose.pupilX, -1, 1) * socketRadiusX * 0.34;
    const pupilY = clamp(params.pose.pupilY, -1, 1) * socketRadiusY * 0.24 +
        (sleepyShape ? radiusY * 0.04 : dropletShape ? radiusY * 0.06 : 0);
    // Love: pupils dilate gradually over ~600ms, settling at 1.3x
    const isLove = dc.emotionName === "love";
    const loveElapsed = isLove ? clamp((dc.elapsed - dc.emotionFromTime) / 600, 0, 1) : 0;
    const loveDilate = 1 + loveElapsed * 0.3;
    const irisRadiusX = Math.max(6, eyeDiameter * 0.19 * loveDilate) *
        pupilScale *
        (sharpShape ? 0.9 : dropletShape ? 0.88 : 1);
    const irisRadiusY = irisRadiusX *
        lerp(0.96, 0.72, blinkAmount) *
        (sleepyShape ? 0.78 : dropletShape ? 1.18 : sharpShape ? 0.92 : 1);
    const pupilRadiusX = irisRadiusX * (sharpShape ? 0.42 : 0.48);
    const pupilRadiusY = irisRadiusY * (sleepyShape ? 0.44 : dropletShape ? 0.56 : 0.52);
    const squishY = lerp(1, sleepyShape ? 0.42 : 0.55, squint);
    ctx.save();
    ctx.translate(params.centerX + params.side * centerShiftX, params.centerY);
    ctx.rotate(params.pose.tilt * 0.4);
    ctx.scale(1, squishY);
    applySegmentStyle(ctx, resolveEyeFill(theme), theme.glow, brightness, eyeDiameter * (reducedDetail ? 0.2 : 0.26));
    if (blinkAmount >= 0.68 || params.pose.openness <= 0.24) {
        fillRoundedSegment(ctx, 0, sleepyShape ? radiusY * 0.02 : dropletShape ? radiusY * 0.06 : 0, eyeBaseWidth * (blockShape ? 0.76 : sharpShape ? 0.68 : dropletShape ? 0.62 : 0.72), lineHeight, sharpShape ? params.side * 0.08 : 0);
        ctx.restore();
        return;
    }
    ctx.save();
    ctx.globalAlpha *= reducedDetail ? 0.08 : 0.1;
    ctx.shadowBlur = eyeDiameter * (reducedDetail ? 0.04 : 0.06);
    traceBuboEyeSocket(ctx, eyeShape, socketRadiusX, socketRadiusY);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha *= 0.35;
    fillRoundedSegment(ctx, 0, hoodY, hoodWidth, hoodHeight);
    ctx.restore();
    if (sleepyShape) {
        ctx.save();
        ctx.globalAlpha *= reducedDetail ? 0.28 : 0.42;
        fillRoundedSegment(ctx, 0, -radiusY * 0.06, topWidth * 0.94, segmentHeight * 0.6);
        ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha *= 0.54;
    fillFeatherSegment(ctx, -shoulderX, shoulderY, shoulderWidth, shoulderHeight, -0.5);
    fillFeatherSegment(ctx, shoulderX, shoulderY, shoulderWidth, shoulderHeight, 0.5);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha *= 0.28;
    fillFeatherSegment(ctx, innerHookX, innerHookY, innerHookWidth, innerHookHeight, params.side * 0.74);
    if (!reducedDetail) {
        fillFeatherSegment(ctx, outerWingX, outerWingY, outerWingWidth, outerWingHeight, params.side * 0.28);
    }
    ctx.restore();
    ctx.save();
    ctx.globalAlpha *= 0.18;
    fillFeatherSegment(ctx, -sideSweepX, sideSweepY, sideSweepWidth, sideSweepHeight, -0.18);
    fillFeatherSegment(ctx, sideSweepX, sideSweepY, sideSweepWidth, sideSweepHeight, 0.18);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha *= 0.48;
    fillFeatherSegment(ctx, -cheekX, cheekY, cheekWidth, cheekHeight, 0.66);
    fillFeatherSegment(ctx, cheekX, cheekY, cheekWidth, cheekHeight, -0.66);
    ctx.restore();
    if (!reducedDetail) {
        ctx.save();
        ctx.globalAlpha *= 0.28;
        fillFeatherSegment(ctx, innerCheekX, innerCheekY, innerCheekWidth, innerCheekHeight, -params.side * 0.34);
        ctx.restore();
        ctx.save();
        ctx.globalAlpha *= 0.26;
        fillRoundedSegment(ctx, 0, chinY, chinWidth, chinHeight);
        ctx.restore();
    }
    if (params.features.pupils && pupilScale > 0.16) {
        ctx.save();
        ctx.shadowColor = BUBO_IRIS_GLOW;
        ctx.shadowBlur = eyeDiameter * (reducedDetail ? 0.1 : 0.16);
        ctx.fillStyle = BUBO_IRIS_FILL;
        fillEllipse(ctx, pupilX, pupilY, irisRadiusX, irisRadiusY);
        ctx.shadowBlur = 0;
        ctx.fillStyle = BUBO_PUPIL_FILL;
        fillEllipse(ctx, pupilX, pupilY, pupilRadiusX, pupilRadiusY);
        if (!reducedDetail) {
            ctx.fillStyle = BUBO_PUPIL_SHINE;
            fillEllipse(ctx, pupilX - irisRadiusX * 0.28, pupilY - irisRadiusY * 0.3, Math.max(2, irisRadiusX * 0.18), Math.max(2, irisRadiusY * 0.16));
            // Glassy second highlight during love — larger, softer
            if (isLove && loveElapsed > 0.2) {
                ctx.globalAlpha *= clamp((loveElapsed - 0.2) / 0.4, 0, 1) * 0.5;
                ctx.fillStyle = "rgba(255, 252, 240, 0.7)";
                fillEllipse(ctx, pupilX + irisRadiusX * 0.18, pupilY + irisRadiusY * 0.14, Math.max(1.5, irisRadiusX * 0.12), Math.max(1.5, irisRadiusY * 0.1));
            }
        }
        ctx.restore();
    }
    ctx.restore();
}
function drawBuboBrow(dc, params) {
    const { ctx, theme } = dc;
    const s = params.side; // -1 left, 1 right
    const w = params.width;
    const browShape = params.parts.browShape ?? "soft";
    const eyeShape = params.parts.eyeShape ?? "soft";
    const eyeWidthScale = clamp(params.parts.eyeWidthScale, 0.65, 1.6);
    const eyeHeightScale = clamp(params.parts.eyeHeightScale, 0.55, 1.8);
    const squint = clamp(params.pose.squint, 0, 1);
    const brightness = clamp(params.pose.brightness, 0.18, 1.4);
    const angryT = dc.emotionName === "angry" ? 1 : 0;
    const sadT = dc.emotionName === "sad" ? 1 : 0;
    const sleepyTheme = eyeShape === "sleepy";
    const sharpTheme = eyeShape === "sharp";
    const dropletTheme = eyeShape === "droplet";
    const themeDrop = sleepyTheme ? 0.08 : dropletTheme ? 0.03 : 0;
    const themeSweep = sharpTheme ? 0.08 : dropletTheme ? 0.03 : 0;
    const angryDropY = angryT * w * 0.08;
    const sadDropY = sadT * w * 0.06;
    const { centerShiftX, browDropY } = resolveBuboEyeOffsets(eyeShape, w, eyeWidthScale, eyeHeightScale);
    const browOpenAmount = resolveBuboBrowOpen(dc);
    ctx.save();
    ctx.translate(params.centerX + s * centerShiftX, params.centerY + browDropY + angryDropY + sadDropY + w * themeDrop * 0.28);
    ctx.rotate(params.pose.tilt * 0.7 + s * (sharpTheme ? -0.05 : sleepyTheme ? 0.012 : 0));
    ctx.globalAlpha *= brightness * 0.92;
    ctx.strokeStyle = resolveEyeFill(theme);
    ctx.shadowColor = theme.glow;
    ctx.shadowBlur = w * 0.06;
    ctx.lineCap = browShape === "angled" ? "butt" : "round";
    ctx.lineJoin = browShape === "angled" ? "miter" : "round";
    const anchorX = s * w * -0.4;
    const anchorY = w * (0.08 + angryT * 0.06 - sadT * 0.03 + themeDrop * 0.4);
    const baseAlpha = ctx.globalAlpha;
    let feathers;
    if (browShape === "bold") {
        feathers = [
            [
                s * -0.46,
                0.3 + angryT * 0.1 + themeDrop * 0.28,
                s * -0.4,
                0.18 + angryT * 0.06,
                0.12 + angryT * 0.03,
                0.62,
            ],
            [
                s * 0.2,
                0.12 + angryT * 0.08 - sadT * 0.04 + themeDrop * 0.2,
                s * -0.04,
                0.12 + angryT * 0.04,
                0.13 + angryT * 0.02,
                0.8,
            ],
            [
                s * (0.94 + themeSweep * 0.25),
                -0.02 - angryT * 0.03 + sadT * 0.04 - squint * 0.02 + themeDrop * 0.1,
                s * 0.56,
                -0.01 + angryT * 0.02,
                0.19 + angryT * 0.05,
                1,
            ],
            [
                s * (1.02 + angryT * 0.05 + themeSweep * 0.36),
                -(0.12 + angryT * 0.05 - sadT * 0.03 + squint * 0.02 - themeDrop * 0.16),
                s * 0.7,
                -(0.06 + angryT * 0.02),
                0.12 + angryT * 0.02,
                0.7,
            ],
        ];
    }
    else if (browShape === "angled") {
        feathers = [
            [
                s * -0.5,
                0.34 + angryT * 0.12 + themeDrop * 0.18,
                s * -0.42,
                0.22 + angryT * 0.08,
                0.08 + angryT * 0.03,
                0.44,
            ],
            [
                s * (0.96 + themeSweep * 0.42),
                -(0.08 + angryT * 0.06 - sadT * 0.04 + squint * 0.02 - themeDrop * 0.1),
                s * 0.46,
                -(0.03 + angryT * 0.01),
                0.15 + angryT * 0.05,
                1,
            ],
            [
                s * (1.12 + angryT * 0.08 + themeSweep * 0.54),
                -(0.2 + angryT * 0.1 - sadT * 0.03 + squint * 0.03 - themeDrop * 0.24),
                s * 0.76,
                -(0.12 + angryT * 0.04),
                0.08 + angryT * 0.02,
                0.58,
            ],
        ];
    }
    else {
        feathers = [
            [
                s * -0.44,
                0.28 + angryT * 0.1 + themeDrop * 0.22,
                s * -0.4,
                0.18 + angryT * 0.06,
                0.09 + angryT * 0.03,
                0.55,
            ],
            [
                s * 0.18,
                0.1 + angryT * 0.08 - sadT * 0.04 + themeDrop * 0.18,
                s * -0.08,
                0.1 + angryT * 0.04,
                0.1 + angryT * 0.02,
                0.7,
            ],
            [
                s * (0.88 + themeSweep * 0.2),
                -0.04 - angryT * 0.02 + sadT * 0.03 - squint * 0.02 + themeDrop * 0.08,
                s * 0.52,
                0.0 + angryT * 0.02 + sadT * 0.01,
                0.13 + angryT * 0.04,
                1.0,
            ],
            [
                s * (1.02 + angryT * 0.06 + themeSweep * 0.3),
                -(0.14 + angryT * 0.06 - sadT * 0.03 + squint * 0.02 - themeDrop * 0.18),
                s * 0.64,
                -(0.06 + angryT * 0.02),
                0.08 + angryT * 0.02,
                0.6,
            ],
            [
                s * (1.1 + angryT * 0.08 + themeSweep * 0.34),
                -(0.24 + angryT * 0.1 - sadT * 0.04 + squint * 0.03 - themeDrop * 0.24),
                s * 0.76,
                -(0.14 + angryT * 0.04),
                0.05,
                0.38,
            ],
        ];
    }
    const layerLifts = [0.16, 0.42, 0.76];
    for (const [index, [tipX, tipY, ctrlX, ctrlY, lineW, opacity]] of feathers.entries()) {
        const layerIndex = Math.min(index, 2);
        const layerLift = layerLifts[layerIndex] ?? layerLifts[2];
        const outerBias = clamp(Math.abs(tipX) * 0.18, 0.04, 0.18);
        const openTipY = tipY - browOpenAmount * (layerLift + outerBias + opacity * 0.06);
        const openCtrlY = ctrlY - browOpenAmount * (layerLift * 0.56 + outerBias * 0.22);
        const openTipX = tipX;
        const openCtrlX = ctrlX;
        ctx.globalAlpha = baseAlpha * opacity;
        ctx.lineWidth = Math.max(1.5, w * lineW);
        ctx.beginPath();
        ctx.moveTo(anchorX, anchorY);
        ctx.quadraticCurveTo(w * openCtrlX, w * openCtrlY, w * openTipX, w * openTipY);
        ctx.stroke();
    }
    ctx.restore();
}
function drawSolidCurvedBar(ctx, centerY, totalWidth, barHeight, curveHeight) {
    const halfWidth = totalWidth * 0.5;
    ctx.save();
    ctx.strokeStyle = typeof ctx.fillStyle === "string" ? ctx.fillStyle : BUBO_BEAK_FILL;
    ctx.lineWidth = barHeight;
    ctx.lineCap = "square";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-halfWidth, centerY);
    ctx.quadraticCurveTo(0, centerY + curveHeight, halfWidth, centerY);
    ctx.stroke();
    ctx.restore();
}
function drawBuboUpperBeak(ctx, shape, width, height, curvature) {
    const curveLift = height * 0.16 * curvature;
    if (shape === "button") {
        const buttonDiameter = Math.min(width * 0.64, height * 0.72);
        roundedRect(ctx, -buttonDiameter * 0.5, -buttonDiameter * 0.46, buttonDiameter, buttonDiameter * 0.92, buttonDiameter * 0.48);
        ctx.fill();
        ctx.save();
        ctx.globalAlpha *= 0.16;
        fillEllipse(ctx, 0, buttonDiameter * 0.1, buttonDiameter * 0.12, buttonDiameter * 0.1);
        ctx.restore();
        return;
    }
    if (shape === "gem") {
        ctx.beginPath();
        ctx.moveTo(0, -height * 0.3);
        ctx.lineTo(width * 0.24, -height * 0.16);
        ctx.lineTo(width * 0.54, 0);
        ctx.lineTo(width * 0.22, height * 0.22 + curveLift * 0.55);
        ctx.lineTo(0, height * 0.34 + curveLift);
        ctx.lineTo(-width * 0.22, height * 0.22 + curveLift * 0.55);
        ctx.lineTo(-width * 0.54, 0);
        ctx.lineTo(-width * 0.24, -height * 0.16);
        ctx.closePath();
        ctx.fill();
        ctx.save();
        ctx.globalAlpha *= 0.14;
        ctx.beginPath();
        ctx.moveTo(0, -height * 0.16);
        ctx.lineTo(width * 0.16, -height * 0.04);
        ctx.lineTo(0, height * 0.2 + curveLift * 0.34);
        ctx.lineTo(-width * 0.16, -height * 0.04);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        return;
    }
    if (shape === "pointed") {
        ctx.beginPath();
        ctx.moveTo(0, -height * 0.38);
        ctx.lineTo(width * 0.54, -height * 0.04);
        ctx.lineTo(width * 0.16, height * 0.14 + curveLift * 0.5);
        ctx.lineTo(0, height * 0.46 + curveLift);
        ctx.lineTo(-width * 0.16, height * 0.14 + curveLift * 0.5);
        ctx.lineTo(-width * 0.54, -height * 0.04);
        ctx.closePath();
        ctx.fill();
        ctx.save();
        ctx.globalAlpha *= 0.18;
        ctx.beginPath();
        ctx.moveTo(0, -height * 0.26);
        ctx.lineTo(width * 0.16, 0);
        ctx.lineTo(0, height * 0.22 + curveLift * 0.35);
        ctx.lineTo(-width * 0.16, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        return;
    }
    ctx.beginPath();
    ctx.moveTo(-width * 0.52, -height * 0.04);
    ctx.quadraticCurveTo(-width * 0.34, -height * 0.34, 0, -height * 0.38);
    ctx.quadraticCurveTo(width * 0.34, -height * 0.34, width * 0.52, -height * 0.04);
    ctx.quadraticCurveTo(width * 0.18, height * 0.02 + curveLift * 0.45, width * 0.1, height * 0.32 + curveLift);
    ctx.lineTo(-width * 0.1, height * 0.32 + curveLift);
    ctx.quadraticCurveTo(-width * 0.18, height * 0.02 + curveLift * 0.45, -width * 0.52, -height * 0.04);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.globalAlpha *= 0.14;
    fillRoundedSegment(ctx, 0, height * 0.1 + curveLift * 0.35, width * 0.13, height * 0.52);
    ctx.restore();
}
function drawBuboNose(dc, params) {
    const { ctx } = dc;
    const noseShape = params.parts.noseShape ?? "bridge";
    const geometry = resolveBeakGeometry(noseShape);
    const scale = clamp(params.pose.scale, 0.72, 1.28) * 0.76;
    const width = params.width * scale;
    const height = params.height * scale;
    const curvature = clamp(params.mouthPose?.curvature ?? 0, -1, 1);
    const smileT = Math.max(0, curvature);
    const frownT = Math.max(0, -curvature);
    const expressionT = Math.max(smileT, frownT);
    const brightness = clamp(params.pose.brightness, 0.22, 1.5) * 0.9;
    const classicBridge = noseShape === "bridge";
    const topWidth = width * geometry.topWidthScale * lerp(classicBridge ? 0.9 : 0.92, 0.86, expressionT);
    const topHeight = classicBridge
        ? Math.max(7, height * Math.max(geometry.topHeightScale, 0.24))
        : Math.max(10, height * Math.max(geometry.topHeightScale * 1.9, 0.36));
    const topY = (classicBridge ? -height * 0.12 : -height * 0.1) + height * (0.04 * smileT - 0.06 * frownT);
    const topCurve = height * (classicBridge ? 0.2 : 0.18) * curvature;
    ctx.save();
    ctx.translate(params.centerX, params.centerY);
    ctx.rotate(params.pose.tilt * 0.18);
    applySegmentStyle(ctx, BUBO_BEAK_FILL, BUBO_BEAK_GLOW, brightness, width * 0.12);
    if (classicBridge) {
        drawSolidCurvedBar(ctx, topY, topWidth, topHeight, topCurve);
    }
    else {
        ctx.translate(0, topY);
        drawBuboUpperBeak(ctx, noseShape, topWidth, topHeight, topCurve / Math.max(1, topHeight));
    }
    ctx.restore();
}
function drawBuboMouth(dc, params) {
    const { ctx } = dc;
    const beakGeometry = resolveBeakGeometry(params.parts.noseShape);
    const geometry = resolveMiddleBarGeometry(params.parts.mouthShape);
    const bandShape = params.parts.mouthShape === "band";
    const blockShape = params.parts.mouthShape === "block";
    const speech = clamp(Math.max(params.pose.openness, dc.speakingAmount * 0.92), 0, 1);
    const curvature = clamp(params.pose.curvature, -1, 1);
    const smileT = Math.max(0, curvature);
    const frownT = Math.max(0, -curvature);
    const poutT = clamp((0.72 - params.pose.width) / 0.32, 0, 1);
    const brightness = clamp(params.pose.brightness, 0.22, 1.5) * 0.92 * lerp(1, 1.06, smileT) * lerp(1, 0.94, frownT);
    const middleWidth = params.width *
        geometry.widthScale *
        clamp(params.pose.width, 0.38, 1.12) *
        lerp(0.98, 0.82, smileT) *
        lerp(1, 0.94, frownT) *
        0.76;
    const middleHeight = Math.max(7, params.height * Math.max(geometry.heightScale, 0.32)) *
        lerp(1, 1.18, poutT) *
        lerp(1, 0.94, smileT);
    const bottomWidth = params.width *
        beakGeometry.bottomWidthScale *
        0.78 *
        (bandShape ? 1.12 : blockShape ? 0.86 : 1) *
        lerp(1, 1.2, smileT) *
        lerp(1, 0.76, frownT) *
        lerp(1, 1.14, poutT);
    const bottomHeight = Math.max(7, params.height * Math.max(beakGeometry.bottomHeightScale * 1.15, 0.22)) *
        (bandShape ? 0.9 : blockShape ? 1.18 : 1) *
        lerp(1, 1.12, poutT) *
        lerp(1, 0.92, smileT);
    const stackOffset = params.height * lerp(0.3, 0.22, poutT);
    const stackShift = params.height * (0.1 * smileT - 0.12 * frownT);
    const middleY = -stackOffset + stackShift - params.height * 0.04 * poutT;
    const bottomBaseY = stackOffset + stackShift - params.height * 0.08 * poutT;
    const smileArch = params.height * 0.11 * smileT;
    const frownArch = params.height * 0.14 * frownT;
    const middleExpressionY = middleY + smileArch * 0.5 - frownArch * 0.75;
    const bottomExpressionY = bottomBaseY - smileArch * 0.45 + frownArch * 0.65;
    const middleCurve = params.height * 0.28 * curvature;
    const bottomCurve = params.height * 0.22 * curvature;
    const openThreshold = 0.16;
    ctx.save();
    ctx.translate(params.centerX, params.centerY);
    applySegmentStyle(ctx, BUBO_BEAK_FILL, BUBO_BEAK_GLOW, brightness, middleWidth * 0.1);
    if (speech <= openThreshold) {
        drawSolidCurvedBar(ctx, middleExpressionY, middleWidth, middleHeight, middleCurve);
    }
    else {
        const t = clamp((speech - openThreshold) / (1 - openThreshold), 0, 1);
        const verticalWidth = Math.max(5, middleWidth * lerp(0.16, 0.12, t));
        const verticalHeight = Math.max(8, params.height * lerp(0.62, 0.9, t)) *
            lerp(1, 1.08, frownT) *
            lerp(1, 0.94, smileT);
        const verticalGap = middleWidth * lerp(0.34, 0.4, t);
        const verticalY = lerp(middleExpressionY + verticalHeight * 0.12, 0, 0.18 + t * 0.14);
        fillCenteredRect(ctx, -verticalGap, verticalY, verticalWidth, verticalHeight);
        fillCenteredRect(ctx, verticalGap, verticalY, verticalWidth, verticalHeight);
    }
    const bottomTravel = speech <= openThreshold
        ? 0
        : params.height * lerp(0, 0.34, (speech - openThreshold) / (1 - openThreshold));
    drawSolidCurvedBar(ctx, bottomExpressionY + bottomTravel, bottomWidth, bottomHeight, bottomCurve);
    ctx.restore();
}
export const buboCharacter = {
    name: "bubo",
    partOptions: {
        eyeShape: ["block", "soft", "wide", "sharp", "sleepy", "droplet"],
        noseShape: ["bridge", "gem", "pointed", "button"],
        mouthShape: ["soft", "band", "block"],
        browShape: ["soft", "bold", "angled"],
    },
    defaultParts: {
        eyeShape: "soft",
        eyeWidthScale: 1,
        eyeHeightScale: 1,
        noseShape: "bridge",
        mouthShape: "soft",
        browShape: "soft",
        scanlineThickness: 1.8,
        scanlineSpacing: 4,
    },
    defaultStyle: buboStyle,
    stylePresets: buboStylePresets,
    lockedStyle: true,
    defaultFeatures: {
        brows: true,
        pupils: true,
    },
    emotions: buboEmotions,
    actions: buboActions,
    drawEye: drawBuboEye,
    drawBrow: drawBuboBrow,
    drawNose: drawBuboNose,
    drawMouth: drawBuboMouth,
    drawOverlay(dc, width, height, _pose) {
        if (dc.displayName !== "love" || dc.mode !== "face") {
            return;
        }
        const { ctx } = dc;
        const t = dc.elapsed / 1000;
        const unit = Math.min(width, height);
        // Rising heart embers — each one loops on its own cycle, drifting
        // upward like glowing sparks from a campfire. Seeded with fixed
        // offsets so the pattern is stable but varied.
        const embers = [
            // [xBias, period, phase, sizeScale, peakAlpha]
            [-0.14, 2.6, 0.0, 0.55, 0.7],
            [0.08, 3.1, 0.4, 0.4, 0.5],
            [-0.04, 2.2, 1.1, 0.7, 0.85],
            [0.16, 2.8, 0.7, 0.35, 0.45],
            [0.0, 3.4, 1.8, 0.6, 0.65],
            [-0.1, 2.4, 2.2, 0.45, 0.55],
            [0.12, 2.0, 1.5, 0.5, 0.6],
        ];
        ctx.save();
        for (const [xBias, period, phase, sizeScale, peakAlpha] of embers) {
            // Each ember loops: rises from bottom to top of face, then resets
            const cycle = ((t + phase) % period) / period; // 0..1
            // Fade in at bottom, full in middle, fade out at top
            let alpha;
            if (cycle < 0.15) {
                alpha = ease("smooth", cycle / 0.15);
            }
            else if (cycle < 0.7) {
                alpha = 1;
            }
            else {
                alpha = 1 - ease("smooth", (cycle - 0.7) / 0.3);
            }
            // Rise from below face center to above it
            const y = height * (0.2 - cycle * 0.5);
            // Gentle horizontal sway
            const sway = Math.sin(cycle * Math.PI * 2.4 + phase) * unit * 0.03;
            const x = width * xBias + sway;
            const size = unit * 0.04 * sizeScale;
            ctx.save();
            ctx.globalAlpha *= alpha * peakAlpha;
            ctx.shadowColor = "rgba(255, 140, 170, 0.6)";
            ctx.shadowBlur = size * 0.5;
            ctx.fillStyle = "#ff7b98";
            drawPixelGlyph(ctx, HEART_PATTERN, x, y, size);
            ctx.restore();
        }
        ctx.restore();
    },
};
