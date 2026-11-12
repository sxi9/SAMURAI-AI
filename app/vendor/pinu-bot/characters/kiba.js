import { clamp, drawPixelGlyph, HEART_PATTERN, roundedRect, wave } from "../drawUtils.js";
import { drawStandardGlyphEye, eyeShapeSupportsPupil, resolveStandardEyeMetrics, } from "../standardFace.js";
import { createStandardBrowRenderer, createStandardNoseRenderer, } from "../standardRobotRenderers.js";
import { eye, pose } from "../stateDefinitions.js";
import { STYLE_PRESETS } from "../styles.js";
const PUPIL_FILL = "#000000";
const LOVE_PUPIL_FILL = "#c81f4f";
const TONGUE_FILL = "#ff8fb3";
const TOOTH_FILL = "#f6fff7";
const PUPIL_SHINE_FILL = "#f7ffff";
const SURFACE_FILL_ALPHA = 0.26;
const SURFACE_STROKE_ALPHA = 0.76;
const DETAIL_LINE_ALPHA = 0.36;
const PATCH_FILL_ALPHA = 0.18;
const SOCKET_FILL_ALPHA = 0.11;
const kibaStyle = {
    ...STYLE_PRESETS.soft,
    eyeWidth: 0.118,
    eyeHeight: 0.128,
    eyeY: -0.092,
    eyeGap: 0.146,
    browWidth: 0.08,
    browHeight: 0.01,
    browY: -0.16,
    noseWidth: 0.142,
    noseHeight: 0.112,
    noseY: 0.008,
    mouthWidth: 0.304,
    mouthHeight: 0.182,
    mouthY: 0.188,
    glowScale: 0.032,
};
const kibaStylePresets = {
    classic: {
        ...kibaStyle,
        panelInsetX: 0.06,
        panelInsetY: 0.078,
        panelRadius: 0.08,
        panelInnerPadding: 0.018,
        eyeWidth: 0.122,
        eyeHeight: 0.132,
        eyeY: -0.094,
        eyeGap: 0.138,
        browWidth: 0.082,
        browHeight: 0.01,
        browY: -0.162,
        noseWidth: 0.144,
        noseHeight: 0.114,
        noseY: 0.008,
        mouthWidth: 0.308,
        mouthHeight: 0.184,
        mouthY: 0.188,
        glowScale: 0.032,
    },
    soft: {
        ...kibaStyle,
    },
    minimal: {
        ...kibaStyle,
        panelInsetX: 0.08,
        panelInsetY: 0.12,
        panelRadius: 0.064,
        panelInnerPadding: 0.015,
        eyeWidth: 0.11,
        eyeHeight: 0.118,
        eyeY: -0.09,
        eyeGap: 0.134,
        browWidth: 0.074,
        browHeight: 0.008,
        browY: -0.154,
        noseWidth: 0.132,
        noseHeight: 0.104,
        noseY: 0.006,
        mouthWidth: 0.286,
        mouthHeight: 0.168,
        mouthY: 0.182,
        glowScale: 0.026,
    },
    visor: {
        ...kibaStyle,
        panelInsetX: 0.052,
        panelInsetY: 0.08,
        panelRadius: 0.102,
        panelInnerPadding: 0.016,
        eyeWidth: 0.144,
        eyeHeight: 0.116,
        eyeY: -0.094,
        eyeGap: 0.126,
        browWidth: 0.092,
        browHeight: 0.01,
        browY: -0.158,
        noseWidth: 0.136,
        noseHeight: 0.1,
        noseY: 0.01,
        mouthWidth: 0.292,
        mouthHeight: 0.166,
        mouthY: 0.188,
        glowScale: 0.038,
    },
    industrial: {
        ...kibaStyle,
        panelInsetX: 0.066,
        panelInsetY: 0.078,
        panelRadius: 0.048,
        panelInnerPadding: 0.014,
        eyeWidth: 0.116,
        eyeHeight: 0.124,
        eyeY: -0.094,
        eyeGap: 0.132,
        browWidth: 0.084,
        browHeight: 0.01,
        browY: -0.158,
        noseWidth: 0.146,
        noseHeight: 0.116,
        noseY: 0.008,
        mouthWidth: 0.314,
        mouthHeight: 0.176,
        mouthY: 0.186,
        glowScale: 0.03,
    },
};
const kibaEmotions = {
    neutral: {
        pose: pose(eye(0.86, 0.05, 0, 0, 0, 1), eye(0.86, 0.05, 0, 0, 0, 1), { scale: 1, tilt: 0, brightness: 1 }, { openness: 0.04, curvature: 0, width: 0.9, tilt: 0, brightness: 0.98 }, { glow: 0.98, bob: 0.01, jitter: 0, distortion: 0, flicker: 0.01, scanline: 0.12 }),
        durationMs: 260,
        ease: "smooth",
        microBob: 0.008,
        microBobHz: 0.8,
        microSway: 0.02,
        blinkMinMs: 3200,
        blinkMaxMs: 5800,
        blinkDurationMs: 180,
    },
    happy: {
        pose: pose(eye(0.98, 0.02, 0, 0, -0.02, 1.08), eye(0.98, 0.02, 0, 0, -0.02, 1.08), { scale: 1.04, tilt: 0, brightness: 1.08 }, { openness: 0.36, curvature: 0.92, width: 0.96, tilt: 0, brightness: 1.1 }, { glow: 1.14, bob: 0.018, jitter: 0, distortion: 0, flicker: 0.02, scanline: 0.1 }),
        durationMs: 220,
        ease: "smooth",
        microBob: 0.014,
        microBobHz: 1.6,
        microSway: 0.03,
        blinkMinMs: 3800,
        blinkMaxMs: 6600,
        blinkDurationMs: 160,
    },
    love: {
        pose: pose(eye(0.9, 0.08, 0, 0, -0.04, 1.08), eye(0.9, 0.08, 0, 0, -0.04, 1.08), { scale: 1.02, tilt: 0, brightness: 1.05 }, { openness: 0.3, curvature: 0.82, width: 0.96, tilt: 0, brightness: 1.1 }, { glow: 1.18, bob: 0.016, jitter: 0, distortion: 0, flicker: 0.016, scanline: 0.1 }),
        durationMs: 240,
        ease: "smooth",
        microBob: 0.014,
        microBobHz: 1.3,
        microSway: 0.03,
        blinkMinMs: 4200,
        blinkMaxMs: 7400,
        blinkDurationMs: 170,
    },
    sad: {
        pose: pose(eye(0.54, 0.06, -0.18, 0, 0.14, 0.8), eye(0.54, 0.06, 0.18, 0, 0.14, 0.8), { scale: 0.92, tilt: 0, brightness: 0.82 }, { openness: 0.02, curvature: -1, width: 0.78, tilt: 0, brightness: 0.76 }, { glow: 0.8, bob: 0.006, jitter: 0, distortion: 0, flicker: 0.006, scanline: 0.16 }),
        durationMs: 420,
        ease: "gentle",
        microBob: 0.006,
        microBobHz: 0.45,
        microSway: 0.02,
        blinkMinMs: 2600,
        blinkMaxMs: 4600,
        blinkDurationMs: 220,
    },
    excited: {
        pose: pose(eye(1, 0.02, 0, 0, -0.04, 1.14), eye(1, 0.02, 0, 0, -0.04, 1.14), { scale: 1.05, tilt: 0, brightness: 1.1 }, { openness: 0.54, curvature: 0.92, width: 1, tilt: 0, brightness: 1.16 }, { glow: 1.24, bob: 0.022, jitter: 0.001, distortion: 0, flicker: 0.024, scanline: 0.08 }),
        durationMs: 160,
        ease: "snap",
        microBob: 0.02,
        microBobHz: 2.2,
        microSway: 0.04,
        blinkMinMs: 4200,
        blinkMaxMs: 7600,
        blinkDurationMs: 150,
    },
    angry: {
        pose: pose(eye(0.46, 0.56, 0.12, 0, -0.04, 1.15), eye(0.46, 0.56, -0.12, 0, -0.04, 1.15), { scale: 1, tilt: 0.08, brightness: 1.05 }, { openness: 0.22, curvature: -0.26, width: 0.94, tilt: 0, brightness: 1.14 }, { glow: 1.14, bob: 0.01, jitter: 0.004, distortion: 0.18, flicker: 0.08, scanline: 0.16 }),
        durationMs: 180,
        ease: "snap",
        microBob: 0.01,
        microBobHz: 2.1,
        microSway: 0.04,
        blinkMinMs: 5200,
        blinkMaxMs: 8200,
        blinkDurationMs: 120,
    },
    confused: {
        pose: pose(eye(0.9, 0.08, -0.08, -0.02, 0.02, 1.04), eye(0.72, 0.12, 0.04, 0.04, -0.01, 0.94), { scale: 1, tilt: -0.1, brightness: 0.98 }, { openness: 0.04, curvature: -0.28, width: 0.84, tilt: -0.1, brightness: 0.94 }, { glow: 1.02, bob: 0.014, jitter: 0, distortion: 0, flicker: 0.014, scanline: 0.12 }),
        durationMs: 260,
        ease: "smooth",
        microBob: 0.012,
        microBobHz: 0.8,
        microSway: 0.035,
        blinkMinMs: 3600,
        blinkMaxMs: 6200,
        blinkDurationMs: 170,
    },
};
function traceEarPath(ctx, width, height, side, bobY, pose) {
    const earOffsetX = side * width * 0.014;
    const topInnerX = side * width * pose.innerX + earOffsetX;
    const topOuterX = side * width * pose.outerX + earOffsetX;
    const ridgeY = height * pose.topY + bobY;
    const shoulderX = side * width * pose.shoulderX + earOffsetX;
    const shoulderY = height * pose.shoulderY + bobY;
    const tipX = side * width * pose.tipX + earOffsetX;
    const tipY = height * pose.tipY + bobY;
    const baseX = side * width * pose.baseX + earOffsetX;
    const baseY = height * pose.baseY + bobY;
    ctx.beginPath();
    ctx.moveTo(topInnerX, ridgeY);
    ctx.bezierCurveTo(side * width * (pose.innerX - 0.004), ridgeY - height * 0.006, side * width * (pose.outerX - 0.018), ridgeY - height * 0.01, topOuterX, ridgeY);
    ctx.bezierCurveTo(side * width * (pose.outerX + 0.026), height * (pose.topY + 0.04) + bobY, side * width * (pose.shoulderX + 0.02), height * (pose.shoulderY - 0.02) + bobY, shoulderX, shoulderY);
    ctx.bezierCurveTo(side * width * (pose.shoulderX - 0.014), height * (pose.shoulderY + 0.12) + bobY, side * width * (pose.tipX + 0.028), height * (pose.tipY - 0.012) + bobY, tipX, tipY);
    ctx.bezierCurveTo(side * width * (pose.tipX - 0.026), height * (pose.tipY + 0.05) + bobY, side * width * (pose.baseX - 0.014), height * (pose.baseY + 0.026) + bobY, baseX, baseY);
    ctx.bezierCurveTo(side * width * (pose.baseX - 0.016), height * (pose.baseY - 0.09) + bobY, side * width * (pose.innerX + 0.016), height * (pose.topY + 0.092) + bobY, topInnerX, ridgeY);
    ctx.closePath();
}
function traceRaisedListeningEarPath(ctx, width, height, side, bobY, _pose) {
    const earOffsetX = side * width * 0.014;
    const innerBaseX = side * width * 0.194 + earOffsetX;
    const innerBaseY = height * 0.014 + bobY;
    const topInnerX = side * width * 0.202 + earOffsetX;
    const topInnerY = -height * 0.17 + bobY;
    const apexX = side * width * 0.238 + earOffsetX;
    const apexY = -height * 0.286 + bobY;
    const upperOuterX = side * width * 0.262 + earOffsetX;
    const upperOuterY = -height * 0.172 + bobY;
    const midOuterX = side * width * 0.278 + earOffsetX;
    const midOuterY = -height * 0.002 + bobY;
    const lowerOuterX = side * width * 0.258 + earOffsetX;
    const lowerOuterY = height * 0.098 + bobY;
    const baseX = side * width * 0.224 + earOffsetX;
    const baseY = height * 0.042 + bobY;
    ctx.beginPath();
    ctx.moveTo(innerBaseX, innerBaseY);
    ctx.quadraticCurveTo(side * width * 0.19 + earOffsetX, -height * 0.074 + bobY, topInnerX, topInnerY);
    ctx.quadraticCurveTo(side * width * 0.212 + earOffsetX, -height * 0.224 + bobY, apexX, apexY);
    ctx.quadraticCurveTo(side * width * 0.25 + earOffsetX, -height * 0.236 + bobY, upperOuterX, upperOuterY);
    ctx.bezierCurveTo(side * width * 0.282 + earOffsetX, -height * 0.102 + bobY, side * width * 0.288 + earOffsetX, height * 0.018 + bobY, midOuterX, midOuterY);
    ctx.bezierCurveTo(side * width * 0.274 + earOffsetX, height * 0.054 + bobY, side * width * 0.268 + earOffsetX, height * 0.084 + bobY, lowerOuterX, lowerOuterY);
    ctx.bezierCurveTo(side * width * 0.244 + earOffsetX, height * 0.084 + bobY, side * width * 0.232 + earOffsetX, height * 0.06 + bobY, baseX, baseY);
    ctx.quadraticCurveTo(side * width * 0.204 + earOffsetX, height * 0.024 + bobY, innerBaseX, innerBaseY);
    ctx.closePath();
}
function resolveEarPoses(displayName) {
    const neutralLeft = {
        innerX: 0.178,
        outerX: 0.272,
        topY: -0.178,
        shoulderX: 0.298,
        shoulderY: -0.046,
        tipX: 0.246,
        tipY: 0.176,
        baseX: 0.194,
        baseY: 0.034,
    };
    const neutralRight = {
        innerX: 0.178,
        outerX: 0.272,
        topY: -0.178,
        shoulderX: 0.298,
        shoulderY: -0.046,
        tipX: 0.246,
        tipY: 0.176,
        baseX: 0.194,
        baseY: 0.034,
    };
    if (displayName === "excited") {
        return applyPointedEarShape({
            left: {
                innerX: 0.18,
                outerX: 0.276,
                topY: -0.204,
                shoulderX: 0.306,
                shoulderY: -0.08,
                tipX: 0.248,
                tipY: 0.124,
                baseX: 0.196,
                baseY: -0.004,
            },
            right: {
                innerX: 0.182,
                outerX: 0.29,
                topY: -0.182,
                shoulderX: 0.318,
                shoulderY: -0.038,
                tipX: 0.262,
                tipY: 0.19,
                baseX: 0.204,
                baseY: 0.05,
            },
            leftBob: -0.014,
            rightBob: 0.018,
        });
    }
    if (displayName === "happy") {
        return applyPointedEarShape({
            left: {
                innerX: 0.178,
                outerX: 0.276,
                topY: -0.19,
                shoulderX: 0.304,
                shoulderY: -0.064,
                tipX: 0.246,
                tipY: 0.144,
                baseX: 0.194,
                baseY: 0.014,
            },
            right: {
                innerX: 0.178,
                outerX: 0.276,
                topY: -0.19,
                shoulderX: 0.304,
                shoulderY: -0.064,
                tipX: 0.246,
                tipY: 0.144,
                baseX: 0.194,
                baseY: 0.014,
            },
            leftBob: -0.004,
            rightBob: 0.004,
        });
    }
    if (displayName === "love") {
        return applyPointedEarShape({
            left: {
                innerX: 0.176,
                outerX: 0.282,
                topY: -0.17,
                shoulderX: 0.31,
                shoulderY: -0.028,
                tipX: 0.252,
                tipY: 0.2,
                baseX: 0.192,
                baseY: 0.056,
            },
            right: {
                innerX: 0.176,
                outerX: 0.282,
                topY: -0.17,
                shoulderX: 0.31,
                shoulderY: -0.028,
                tipX: 0.252,
                tipY: 0.2,
                baseX: 0.192,
                baseY: 0.056,
            },
            leftBob: 0.012,
            rightBob: 0.012,
        });
    }
    if (displayName === "sad") {
        return applyPointedEarShape({
            left: {
                innerX: 0.176,
                outerX: 0.266,
                topY: -0.164,
                shoulderX: 0.292,
                shoulderY: -0.02,
                tipX: 0.24,
                tipY: 0.218,
                baseX: 0.188,
                baseY: 0.07,
            },
            right: {
                innerX: 0.176,
                outerX: 0.266,
                topY: -0.164,
                shoulderX: 0.292,
                shoulderY: -0.02,
                tipX: 0.24,
                tipY: 0.218,
                baseX: 0.188,
                baseY: 0.07,
            },
            leftBob: 0.012,
            rightBob: 0.012,
        });
    }
    if (displayName === "angry") {
        return applyPointedEarShape({
            left: {
                innerX: 0.19,
                outerX: 0.236,
                topY: -0.196,
                shoulderX: 0.246,
                shoulderY: -0.122,
                tipX: 0.22,
                tipY: 0.082,
                baseX: 0.188,
                baseY: -0.04,
            },
            right: {
                innerX: 0.19,
                outerX: 0.236,
                topY: -0.196,
                shoulderX: 0.246,
                shoulderY: -0.122,
                tipX: 0.22,
                tipY: 0.082,
                baseX: 0.188,
                baseY: -0.04,
            },
            leftBob: -0.004,
            rightBob: -0.004,
        });
    }
    if (displayName === "confused") {
        return applyPointedEarShape({
            left: {
                innerX: 0.168,
                outerX: 0.246,
                topY: -0.148,
                shoulderX: 0.268,
                shoulderY: 0.01,
                tipX: 0.214,
                tipY: 0.244,
                baseX: 0.168,
                baseY: 0.102,
            },
            right: {
                innerX: 0.182,
                outerX: 0.27,
                topY: -0.186,
                shoulderX: 0.296,
                shoulderY: -0.054,
                tipX: 0.244,
                tipY: 0.16,
                baseX: 0.194,
                baseY: 0.024,
            },
            leftBob: 0.024,
            rightBob: -0.01,
        });
    }
    return applyPointedEarShape({
        left: neutralLeft,
        right: neutralRight,
        leftBob: 0,
        rightBob: 0,
    });
}
function applyPointedEarShape(earPoses) {
    return {
        left: {
            ...earPoses.left,
            innerX: earPoses.left.innerX + 0.008,
            outerX: earPoses.left.outerX - 0.026,
            shoulderX: earPoses.left.shoulderX - 0.03,
            tipX: earPoses.left.tipX - 0.056,
        },
        right: {
            ...earPoses.right,
            innerX: earPoses.right.innerX + 0.008,
            outerX: earPoses.right.outerX - 0.024,
            shoulderX: earPoses.right.shoulderX - 0.028,
            tipX: earPoses.right.tipX - 0.054,
        },
        leftBob: earPoses.leftBob,
        rightBob: earPoses.rightBob,
    };
}
function createUprightListeningEar(base) {
    return {
        ...base,
        topY: base.topY - 0.052,
        shoulderY: base.shoulderY - 0.074,
        tipY: base.baseY - 0.004,
        baseY: base.baseY - 0.008,
        innerX: base.innerX + 0.014,
        outerX: base.outerX - 0.018,
        shoulderX: base.shoulderX - 0.024,
        tipX: base.baseX + 0.006,
        baseX: base.baseX - 0.002,
    };
}
function applyListeningEarLift(earPoses) {
    return {
        left: {
            ...earPoses.left,
            topY: earPoses.left.topY - 0.008,
            shoulderY: earPoses.left.shoulderY - 0.01,
            tipY: earPoses.left.tipY - 0.018,
            baseY: earPoses.left.baseY - 0.006,
            innerX: earPoses.left.innerX + 0.003,
            outerX: earPoses.left.outerX - 0.004,
            shoulderX: earPoses.left.shoulderX - 0.004,
            tipX: earPoses.left.tipX - 0.008,
            baseX: earPoses.left.baseX - 0.002,
        },
        right: createUprightListeningEar(earPoses.right),
        leftBob: earPoses.leftBob - 0.002,
        rightBob: earPoses.rightBob - 0.008,
    };
}
function drawEarFold(ctx, width, height, side, bobY, pose) {
    const earOffsetX = side * width * 0.014;
    const startX = side * width * (pose.innerX + 0.02) + earOffsetX;
    const startY = height * (pose.topY + 0.072) + bobY;
    const controlX = side * width * (pose.shoulderX - 0.038) + earOffsetX;
    const controlY = height * (pose.shoulderY + 0.024) + bobY;
    const endX = side * width * (pose.baseX + 0.014) + earOffsetX;
    const endY = height * (pose.baseY + (pose.tipY - pose.baseY) * 0.3) + bobY;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(controlX, controlY, endX, endY);
    ctx.stroke();
}
function drawRaisedListeningEarFold(ctx, width, height, side, bobY, _pose) {
    const earOffsetX = side * width * 0.014;
    const startX = side * width * 0.22 + earOffsetX;
    const startY = -height * 0.138 + bobY;
    const controlX = side * width * 0.244 + earOffsetX;
    const controlY = -height * 0.194 + bobY;
    const endX = side * width * 0.228 + earOffsetX;
    const endY = height * 0.016 + bobY;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(controlX, controlY, endX, endY);
    ctx.stroke();
}
function resolveKibaEyeMetrics(width, height, pose, side, displayName, style) {
    const eyeMetrics = resolveStandardEyeMetrics({
        width: width * style.eyeWidth,
        height: height * style.eyeHeight,
        openness: pose.openness,
        squint: pose.squint,
        widthBase: 0.86,
        widthOpenFactor: 0.14,
    });
    const confusedTilt = displayName === "confused";
    const confusedScale = confusedTilt ? (side === -1 ? 1.18 : 0.94) : 1;
    const confusedY = confusedTilt
        ? side === -1
            ? eyeMetrics.baseHeight * 0.1
            : -eyeMetrics.baseHeight * 0.06
        : 0;
    const confusedX = confusedTilt
        ? side === -1
            ? -eyeMetrics.baseWidth * 0.02
            : eyeMetrics.baseWidth * 0.01
        : 0;
    const excitedWide = displayName === "excited" ? 1.14 : displayName === "happy" ? 1.03 : 1;
    const excitedShort = displayName === "excited" ? 0.92 : 1;
    return {
        centerX: side * width * style.eyeGap + confusedX,
        centerY: height * style.eyeY + confusedY,
        width: eyeMetrics.width * confusedScale * excitedWide,
        height: eyeMetrics.height * confusedScale * excitedShort,
    };
}
function kibaEyeShapeSupportsPupil(shape) {
    return (eyeShapeSupportsPupil(shape) || shape === "sharp" || shape === "sleepy" || shape === "droplet");
}
function strokeCubicRange(ctx, startT, endT, p0, p1, p2, p3, segments = 12) {
    ctx.beginPath();
    const start = cubicPoint(startT, p0, p1, p2, p3);
    ctx.moveTo(start.x, start.y);
    for (let index = 1; index <= segments; index += 1) {
        const t = startT + (endT - startT) * (index / segments);
        const point = cubicPoint(t, p0, p1, p2, p3);
        ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
}
function cubicPoint(t, p0, p1, p2, p3) {
    const invT = 1 - t;
    return {
        x: invT * invT * invT * p0.x +
            3 * invT * invT * t * p1.x +
            3 * invT * t * t * p2.x +
            t * t * t * p3.x,
        y: invT * invT * invT * p0.y +
            3 * invT * invT * t * p1.y +
            3 * invT * t * t * p2.y +
            t * t * t * p3.y,
    };
}
function findInnerEarVisibleEndT(eyeMetrics, p0, p1, p2, p3, height) {
    const targetY = eyeMetrics.centerY + eyeMetrics.height * 0.58 + height * 0.008;
    const samples = 40;
    for (let index = 0; index <= samples; index += 1) {
        const t = index / samples;
        const point = cubicPoint(t, p0, p1, p2, p3);
        if (point.y <= targetY) {
            return clamp(t - 0.015, 0.08, 0.4);
        }
    }
    return 0.24;
}
const drawKibaBrow = createStandardBrowRenderer({
    defaultShape: "soft",
    resolveAngle: (dc, params) => {
        const baseAngle = params.pose.tilt * 0.05;
        if (dc.actionName === "thinking" && params.side === 1) {
            return baseAngle + 0.05;
        }
        return baseAngle;
    },
    resolveLift: (dc, params) => {
        if (dc.actionName === "thinking" && params.side === 1) {
            return params.height * 0.36;
        }
        return 0;
    },
    resolveBrightness: (_dc, params) => clamp(params.pose.brightness, 0.2, 1.2) * 0.45,
    renderSoft: (ctx, params) => {
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(1.25, params.height * 0.46);
        ctx.beginPath();
        ctx.moveTo(-params.width * 0.22, 0);
        ctx.lineTo(params.width * 0.22, 0);
        ctx.stroke();
    },
    renderBold: (ctx, params) => {
        roundedRect(ctx, -params.width * 0.26, -params.height * 0.22, params.width * 0.52, params.height * 0.44, params.height * 0.14);
        ctx.fill();
    },
    renderAngled: (ctx, params) => {
        ctx.beginPath();
        ctx.moveTo(-params.width * 0.28, params.height * 0.16);
        ctx.lineTo(-params.width * 0.08, -params.height * 0.24);
        ctx.lineTo(params.width * 0.28, -params.height * 0.08);
        ctx.lineTo(params.width * 0.08, params.height * 0.22);
        ctx.closePath();
        ctx.fill();
    },
});
const drawKibaNose = createStandardNoseRenderer({
    defaultShape: "pointed",
    resolveBrightness: (_dc, params) => clamp(params.pose.brightness, 0.1, 1.6),
    resolveOffset: (dc, params) => ({
        x: (dc.emotionName === "confused" ? -params.width * 0.02 : 0) +
            (dc.actionName === "listening" ? -params.width * 0.04 : 0),
        y: (dc.emotionName === "confused" ? params.height * 0.04 : 0) +
            (dc.actionName === "listening" ? -params.height * 0.02 : 0),
    }),
    resolveRotation: (dc, params) => params.pose.tilt * 0.3 +
        (dc.emotionName === "confused" ? -0.1 : 0) +
        (dc.actionName === "listening" ? -0.08 : 0),
    configureContext: (ctx, dc, params, width) => {
        ctx.lineWidth = Math.max(1.5, params.height * 0.048);
        ctx.lineJoin = "round";
        ctx.shadowColor = dc.theme.glow;
        ctx.shadowBlur = Math.max(0, width * 0.16);
    },
    renderShape: (ctx, shape, width, height) => {
        drawDogNoseShape(ctx, shape, width, height);
        ctx.stroke();
        ctx.save();
        ctx.globalAlpha *= 0.42;
        ctx.fillStyle = PUPIL_SHINE_FILL;
        ctx.shadowBlur = 0;
        drawDogNoseShine(ctx, shape, width, height);
        ctx.fill();
        ctx.restore();
    },
});
function strokeEarOutline(ctx, width, height, side, bobY, pose, eyeMetrics) {
    const earOffsetX = side * width * 0.014;
    const topInner = {
        x: side * width * pose.innerX + earOffsetX,
        y: height * pose.topY + bobY,
    };
    const topInnerCtrlA = {
        x: side * width * (pose.innerX - 0.004) + earOffsetX,
        y: height * pose.topY + bobY - height * 0.006,
    };
    const topInnerCtrlB = {
        x: side * width * (pose.outerX - 0.018) + earOffsetX,
        y: height * pose.topY + bobY - height * 0.01,
    };
    const topOuter = {
        x: side * width * pose.outerX + earOffsetX,
        y: height * pose.topY + bobY,
    };
    const shoulderCtrlA = {
        x: side * width * (pose.outerX + 0.026) + earOffsetX,
        y: height * (pose.topY + 0.04) + bobY,
    };
    const shoulderCtrlB = {
        x: side * width * (pose.shoulderX + 0.02) + earOffsetX,
        y: height * (pose.shoulderY - 0.02) + bobY,
    };
    const shoulder = {
        x: side * width * pose.shoulderX + earOffsetX,
        y: height * pose.shoulderY + bobY,
    };
    const tipCtrlA = {
        x: side * width * (pose.shoulderX - 0.014) + earOffsetX,
        y: height * (pose.shoulderY + 0.12) + bobY,
    };
    const tipCtrlB = {
        x: side * width * (pose.tipX + 0.028) + earOffsetX,
        y: height * (pose.tipY - 0.012) + bobY,
    };
    const tip = {
        x: side * width * pose.tipX + earOffsetX,
        y: height * pose.tipY + bobY,
    };
    const baseCtrlA = {
        x: side * width * (pose.tipX - 0.026) + earOffsetX,
        y: height * (pose.tipY + 0.05) + bobY,
    };
    const baseCtrlB = {
        x: side * width * (pose.baseX - 0.014) + earOffsetX,
        y: height * (pose.baseY + 0.026) + bobY,
    };
    const base = {
        x: side * width * pose.baseX + earOffsetX,
        y: height * pose.baseY + bobY,
    };
    const innerCtrlA = {
        x: side * width * (pose.baseX - 0.016) + earOffsetX,
        y: height * (pose.baseY - 0.09) + bobY,
    };
    const innerCtrlB = {
        x: side * width * (pose.innerX + 0.016) + earOffsetX,
        y: height * (pose.topY + 0.092) + bobY,
    };
    const innerVisibleEndT = findInnerEarVisibleEndT(eyeMetrics, base, innerCtrlA, innerCtrlB, topInner, height);
    // Only cut the inner return. Keep the top ear border continuous.
    strokeCubicRange(ctx, 0, 1, topInner, topInnerCtrlA, topInnerCtrlB, topOuter, 8);
    strokeCubicRange(ctx, 0, 1, topOuter, shoulderCtrlA, shoulderCtrlB, shoulder, 10);
    strokeCubicRange(ctx, 0, 1, shoulder, tipCtrlA, tipCtrlB, tip, 10);
    strokeCubicRange(ctx, 0, 1, tip, baseCtrlA, baseCtrlB, base, 10);
    strokeCubicRange(ctx, 0, innerVisibleEndT, base, innerCtrlA, innerCtrlB, topInner, 10);
}
function drawDogEyeShell(ctx, shape, width, height) {
    if (shape === "block") {
        roundedRect(ctx, -width * 0.5, -height * 0.5, width, height, width * 0.14);
        return;
    }
    if (shape === "wide") {
        roundedRect(ctx, -width * 0.5, -height * 0.46, width, height * 0.92, height * 0.42);
        return;
    }
    roundedRect(ctx, -width * 0.5, -height * 0.5, width, height, Math.min(width, height) * 0.5);
}
function drawDogEyeSocket(ctx, shape, width, height) {
    if (shape === "wide") {
        roundedRect(ctx, -width * 0.54, -height * 0.48, width * 1.08, height * 0.96, height * 0.48);
        return;
    }
    roundedRect(ctx, -width * 0.56, -height * 0.5, width * 1.12, height, Math.min(width, height) * 0.56);
}
function drawPupilShine(ctx, pupilX, pupilY, pupilSize) {
    const shineSize = pupilSize * 0.28;
    roundedRect(ctx, pupilX - pupilSize * 0.18, pupilY - pupilSize * 0.22, shineSize, shineSize, shineSize * 0.5);
}
function drawDogTriangleNose(ctx, width, height) {
    ctx.beginPath();
    ctx.moveTo(-width * 0.18, -height * 0.18);
    ctx.quadraticCurveTo(0, -height * 0.28, width * 0.18, -height * 0.18);
    ctx.quadraticCurveTo(width * 0.4, -height * 0.14, width * 0.42, height * 0.02);
    ctx.quadraticCurveTo(width * 0.4, height * 0.2, width * 0.24, height * 0.34);
    ctx.quadraticCurveTo(width * 0.12, height * 0.44, 0, height * 0.46);
    ctx.quadraticCurveTo(-width * 0.12, height * 0.44, -width * 0.24, height * 0.34);
    ctx.quadraticCurveTo(-width * 0.4, height * 0.2, -width * 0.42, height * 0.02);
    ctx.quadraticCurveTo(-width * 0.4, -height * 0.14, -width * 0.18, -height * 0.18);
    ctx.closePath();
}
function drawDogNoseShape(ctx, shape, width, height) {
    if (shape === "bridge") {
        roundedRect(ctx, -width * 0.42, -height * 0.16, width * 0.84, height * 0.42, height * 0.18);
        return;
    }
    if (shape === "button") {
        roundedRect(ctx, -width * 0.22, -height * 0.1, width * 0.44, height * 0.44, width * 0.22);
        return;
    }
    if (shape === "gem") {
        ctx.beginPath();
        ctx.moveTo(0, -height * 0.26);
        ctx.lineTo(width * 0.34, 0);
        ctx.lineTo(0, height * 0.34);
        ctx.lineTo(-width * 0.34, 0);
        ctx.closePath();
        return;
    }
    drawDogTriangleNose(ctx, width, height);
}
function drawDogNoseShine(ctx, shape, width, height) {
    if (shape === "button") {
        const shineSize = width * 0.1;
        roundedRect(ctx, -width * 0.1, -height * 0.05, shineSize, shineSize, shineSize * 0.5);
        return;
    }
    if (shape === "gem") {
        ctx.beginPath();
        ctx.moveTo(-width * 0.12, -height * 0.09);
        ctx.lineTo(-width * 0.04, -height * 0.13);
        ctx.lineTo(width * 0.02, -height * 0.07);
        ctx.lineTo(-width * 0.06, -height * 0.03);
        ctx.closePath();
        return;
    }
    const shineWidth = width * 0.18;
    const shineHeight = height * 0.09;
    const leftX = -width * 0.21;
    const centerY = -height * 0.075;
    const tipX = leftX + shineWidth;
    ctx.beginPath();
    ctx.moveTo(leftX + shineHeight * 0.45, centerY - shineHeight * 0.5);
    ctx.bezierCurveTo(leftX - shineHeight * 0.08, centerY - shineHeight * 0.46, leftX - shineHeight * 0.08, centerY + shineHeight * 0.46, leftX + shineHeight * 0.45, centerY + shineHeight * 0.5);
    ctx.bezierCurveTo(leftX + shineWidth * 0.54, centerY + shineHeight * 0.42, tipX - shineWidth * 0.08, centerY + shineHeight * 0.12, tipX, centerY);
    ctx.bezierCurveTo(tipX - shineWidth * 0.08, centerY - shineHeight * 0.12, leftX + shineWidth * 0.54, centerY - shineHeight * 0.42, leftX + shineHeight * 0.45, centerY - shineHeight * 0.5);
    ctx.closePath();
}
function drawDogArcMuzzlePad(ctx, mouthWidth, height, curvature, openness) {
    const smileAmount = Math.max(0, curvature);
    const frownAmount = Math.max(0, -curvature);
    const width = mouthWidth * (0.88 + smileAmount * 0.06 - frownAmount * 0.04);
    const topY = -height * (0.4 + smileAmount * 0.015 - openness * 0.015);
    const upperBulgeY = -height * (0.5 + smileAmount * 0.015 - frownAmount * 0.01);
    const cheekY = height * (0.04 - smileAmount * 0.03 + frownAmount * 0.05);
    const lowerCheekY = height * (0.28 - smileAmount * 0.04 + openness * 0.06 + frownAmount * 0.06);
    const bottomY = height * (0.46 - smileAmount * 0.04 + openness * 0.12 + frownAmount * 0.08);
    const topCornerY = topY - height * (0.038 - smileAmount * 0.006);
    const upperBridgeY = -height * (0.45 + smileAmount * 0.012 - frownAmount * 0.008);
    const topShoulderX = width * 0.5;
    const upperBridgeX = width * 0.34;
    ctx.beginPath();
    ctx.moveTo(-width * 0.56, topY + height * 0.02);
    ctx.bezierCurveTo(-topShoulderX, topCornerY, -upperBridgeX, upperBridgeY, -width * 0.18, upperBulgeY);
    ctx.quadraticCurveTo(0, -height * 0.4, width * 0.18, upperBulgeY);
    ctx.bezierCurveTo(upperBridgeX, upperBridgeY, topShoulderX, topCornerY, width * 0.56, topY + height * 0.02);
    ctx.quadraticCurveTo(width * 0.62, cheekY, width * 0.32, lowerCheekY);
    ctx.quadraticCurveTo(width * 0.18, height * 0.46, 0, bottomY);
    ctx.quadraticCurveTo(-width * 0.18, height * 0.46, -width * 0.32, lowerCheekY);
    ctx.quadraticCurveTo(-width * 0.62, cheekY, -width * 0.56, topY + height * 0.02);
    ctx.closePath();
}
function drawDogVisorMuzzlePad(ctx, mouthWidth, height, curvature, openness) {
    const smileAmount = Math.max(0, curvature);
    const frownAmount = Math.max(0, -curvature);
    const width = mouthWidth * (0.94 + smileAmount * 0.04);
    const topY = -height * (0.34 - openness * 0.02);
    const bottomY = height * (0.38 + openness * 0.1 + frownAmount * 0.06);
    const cheekY = height * (0.08 + frownAmount * 0.04);
    const sideInset = width * 0.16;
    ctx.beginPath();
    ctx.moveTo(-width * 0.5, topY);
    ctx.quadraticCurveTo(-width * 0.18, topY - height * 0.1, 0, topY - smileAmount * height * 0.04);
    ctx.quadraticCurveTo(width * 0.18, topY - height * 0.1, width * 0.5, topY);
    ctx.lineTo(width * (0.54 - sideInset / width), cheekY);
    ctx.quadraticCurveTo(width * 0.34, bottomY, 0, bottomY + height * 0.06);
    ctx.quadraticCurveTo(-width * 0.34, bottomY, -width * (0.54 - sideInset / width), cheekY);
    ctx.closePath();
}
function drawDogPixelMuzzlePad(ctx, mouthWidth, height, curvature, openness) {
    const smileAmount = Math.max(0, curvature);
    const frownAmount = Math.max(0, -curvature);
    const width = mouthWidth * 0.84;
    const topY = -height * (0.32 - openness * 0.02);
    const bottomY = height * (0.44 + openness * 0.08 + frownAmount * 0.05);
    const centerDip = smileAmount * height * 0.03 - frownAmount * height * 0.02;
    ctx.beginPath();
    ctx.moveTo(-width * 0.56, topY + height * 0.04);
    ctx.lineTo(-width * 0.34, topY - height * 0.08);
    ctx.lineTo(width * 0.34, topY - height * 0.08 + centerDip);
    ctx.lineTo(width * 0.56, topY + height * 0.04);
    ctx.lineTo(width * 0.42, height * 0.24);
    ctx.lineTo(width * 0.18, bottomY);
    ctx.lineTo(-width * 0.18, bottomY);
    ctx.lineTo(-width * 0.42, height * 0.24);
    ctx.closePath();
}
function drawDogMuzzlePad(ctx, shape, mouthWidth, height, curvature, openness) {
    if (shape === "band") {
        drawDogVisorMuzzlePad(ctx, mouthWidth, height, curvature, openness);
        return;
    }
    if (shape === "block") {
        drawDogPixelMuzzlePad(ctx, mouthWidth, height, curvature, openness);
        return;
    }
    drawDogArcMuzzlePad(ctx, mouthWidth, height, curvature, openness);
}
function drawDogMouth(ctx, mouthWidth, height, curvature, openness) {
    const { lineHalfWidth, lipY, controlY } = resolveDogMouthGeometry(mouthWidth, height, curvature, openness);
    ctx.beginPath();
    ctx.moveTo(-lineHalfWidth, lipY);
    ctx.quadraticCurveTo(0, controlY, lineHalfWidth, lipY);
    ctx.stroke();
}
function drawDogSpeakingChatter(ctx, mouthWidth, height, curvature, openness) {
    const { lineHalfWidth, lipY, controlY } = resolveDogMouthGeometry(mouthWidth, height, curvature, openness);
    const upperHalfWidth = lineHalfWidth * 0.82;
    const lowerHalfWidth = upperHalfWidth * 0.88;
    const lowerOpenDepth = height * (0.12 + openness * 0.92);
    const lowerLipY = lipY + lowerOpenDepth * 0.2;
    const lowerControlY = lowerLipY +
        lowerOpenDepth * (0.72 - Math.max(0, curvature) * 0.1 + Math.max(0, -curvature) * 0.08);
    ctx.beginPath();
    ctx.moveTo(-upperHalfWidth, resolveDogMouthCurveY(-upperHalfWidth, lineHalfWidth, lipY, controlY));
    ctx.quadraticCurveTo(0, controlY, upperHalfWidth, resolveDogMouthCurveY(upperHalfWidth, lineHalfWidth, lipY, controlY));
    ctx.stroke();
    ctx.save();
    ctx.globalAlpha *= 0.88;
    ctx.beginPath();
    ctx.moveTo(-lowerHalfWidth, lowerLipY);
    ctx.quadraticCurveTo(0, lowerControlY, lowerHalfWidth, lowerLipY);
    ctx.stroke();
    ctx.restore();
}
function resolveDogMouthGeometry(mouthWidth, height, curvature, openness) {
    const smileAmount = Math.max(0, curvature);
    const frownAmount = Math.max(0, -curvature);
    const tongueWidth = mouthWidth * (0.48 + openness * 0.18 + smileAmount * 0.12);
    const tongueHeight = height * (0.42 + openness * 1.18 + smileAmount * 0.22);
    const tongueTopY = height * (-0.016 + openness * 0.015 - smileAmount * 0.016 + frownAmount * 0.01);
    const smileLift = curvature * height * 0.12;
    const tongueHalfWidth = tongueWidth * 0.46;
    const lineHalfWidth = tongueHalfWidth * 1.42;
    const lipY = tongueTopY - tongueHeight * 0.02 + smileLift;
    const controlY = lipY + smileAmount * height * 0.34 - frownAmount * height * (0.3 + openness * 0.02);
    const tongueBottomY = tongueTopY + tongueHeight * 0.16 + smileLift;
    return {
        lineHalfWidth,
        tongueHalfWidth,
        lipY,
        controlY,
        tongueBottomY,
    };
}
function resolveDogMouthCurveY(x, lineHalfWidth, lipY, controlY) {
    if (lineHalfWidth <= 0.0001) {
        return lipY;
    }
    const t = clamp((x + lineHalfWidth) / (lineHalfWidth * 2), 0, 1);
    const invT = 1 - t;
    return invT * invT * lipY + 2 * invT * t * controlY + t * t * lipY;
}
function strokeDogMouthCurveSpan(ctx, lineHalfWidth, lipY, controlY, startX, endX) {
    const segments = 14;
    ctx.beginPath();
    ctx.moveTo(startX, resolveDogMouthCurveY(startX, lineHalfWidth, lipY, controlY));
    for (let index = 1; index <= segments; index += 1) {
        const t = index / segments;
        const x = startX + (endX - startX) * t;
        ctx.lineTo(x, resolveDogMouthCurveY(x, lineHalfWidth, lipY, controlY));
    }
    ctx.stroke();
}
function resolveDogTongueGeometry(mouthWidth, height, curvature, openness) {
    const smileAmount = Math.max(0, curvature);
    const tongueHeight = height * (0.22 + openness * 0.78 + smileAmount * 0.08);
    const tongueTopY = height * (0.02 + openness * 0.02 - smileAmount * 0.01);
    const smileLift = curvature * height * 0.12;
    const { lineHalfWidth, tongueHalfWidth, lipY, controlY, tongueBottomY } = resolveDogMouthGeometry(mouthWidth, height, curvature, openness);
    const leftTopY = resolveDogMouthCurveY(-tongueHalfWidth, lineHalfWidth, lipY, controlY);
    const rightTopY = resolveDogMouthCurveY(tongueHalfWidth, lineHalfWidth, lipY, controlY);
    const centerTopY = resolveDogMouthCurveY(0, lineHalfWidth, lipY, controlY);
    const tipY = tongueTopY + tongueHeight * 1.18 + smileLift;
    return {
        lineHalfWidth,
        tongueHalfWidth,
        lipY,
        controlY,
        tongueBottomY,
        leftTopY,
        rightTopY,
        centerTopY,
        tipY,
    };
}
function drawDogTongue(ctx, mouthWidth, height, curvature, openness) {
    const { lineHalfWidth, tongueHalfWidth, lipY, controlY, tongueBottomY, leftTopY, rightTopY, tipY, } = resolveDogTongueGeometry(mouthWidth, height, curvature, openness);
    const topSegments = 12;
    const stepX = (tongueHalfWidth * 2) / topSegments;
    ctx.beginPath();
    ctx.moveTo(-tongueHalfWidth, leftTopY);
    ctx.lineTo(-tongueHalfWidth, tongueBottomY);
    ctx.quadraticCurveTo(0, tipY, tongueHalfWidth, tongueBottomY);
    ctx.lineTo(tongueHalfWidth, rightTopY);
    for (let index = topSegments - 1; index >= 0; index -= 1) {
        const x = -tongueHalfWidth + stepX * index;
        ctx.lineTo(x, resolveDogMouthCurveY(x, lineHalfWidth, lipY, controlY));
    }
    ctx.closePath();
}
function drawDogTongueOutline(ctx, mouthWidth, height, curvature, openness) {
    const { tongueHalfWidth, tongueBottomY, leftTopY, rightTopY, tipY } = resolveDogTongueGeometry(mouthWidth, height, curvature, openness);
    ctx.beginPath();
    ctx.moveTo(-tongueHalfWidth, leftTopY);
    ctx.lineTo(-tongueHalfWidth, tongueBottomY);
    ctx.quadraticCurveTo(0, tipY, tongueHalfWidth, tongueBottomY);
    ctx.lineTo(tongueHalfWidth, rightTopY);
}
function drawDogTongueSeam(ctx, mouthWidth, height, curvature, openness, topT = 0.18, bottomT = 0.56, offsetY = 0) {
    const { centerTopY, tipY } = resolveDogTongueGeometry(mouthWidth, height, curvature, openness);
    const seamTopY = centerTopY + (tipY - centerTopY) * topT + offsetY;
    const seamBottomY = centerTopY + (tipY - centerTopY) * bottomT + offsetY;
    ctx.beginPath();
    ctx.moveTo(0, seamTopY);
    ctx.lineTo(0, seamBottomY);
}
function drawDogMuzzleSplit(ctx, mouthWidth, height, curvature, openness) {
    const { lineHalfWidth, lipY, controlY } = resolveDogMouthGeometry(mouthWidth, height, curvature, openness);
    const splitTopY = -height * 0.54;
    const narrowMouthT = clamp((height * 0.92 - mouthWidth) / (height * 0.44), 0, 1);
    const splitBottomY = resolveDogMouthCurveY(0, lineHalfWidth, lipY, controlY) +
        height * (0.006 + narrowMouthT * 0.024);
    ctx.beginPath();
    ctx.moveTo(0, splitTopY);
    ctx.lineTo(0, splitBottomY);
}
function drawDogTeeth(ctx, mouthWidth, height, curvature, openness) {
    const frownAmount = Math.max(0, -curvature);
    const upperWidth = mouthWidth * (0.98 + Math.max(0, curvature) * 0.05);
    const upperDrop = height * (0.14 + Math.max(0, curvature) * 0.06 + frownAmount * 0.12);
    const tongueTopY = height * (0.12 + openness * 0.05 + Math.max(0, curvature) * 0.02);
    const smileLift = curvature * height * 0.1;
    const cornerInset = upperWidth * 0.22;
    const cornerY = tongueTopY - height * 0.02 + smileLift + frownAmount * height * 0.12;
    const teethSpan = cornerInset * 2.34;
    const toothCount = 7;
    const toothGap = teethSpan * 0.015;
    const toothWidth = (teethSpan - toothGap * (toothCount - 1)) / toothCount;
    const baseDepth = height * (0.2 + openness * 0.12 + frownAmount * 0.08);
    const leftEdge = -teethSpan * 0.5;
    const centerIndex = (toothCount - 1) * 0.5;
    const ridgeLift = upperDrop * 0.22 + frownAmount * height * 0.04;
    ctx.beginPath();
    for (let index = 0; index < toothCount; index += 1) {
        const startX = leftEdge + index * (toothWidth + toothGap);
        const endX = startX + toothWidth;
        const tipX = (startX + endX) * 0.5;
        const centerWeight = 1 - Math.abs(index - centerIndex) / centerIndex;
        const startT = clamp((startX + cornerInset) / (cornerInset * 2), 0, 1);
        const endT = clamp((endX + cornerInset) / (cornerInset * 2), 0, 1);
        const tipT = clamp((tipX + cornerInset) / (cornerInset * 2), 0, 1);
        const startY = cornerY - ridgeLift * (1 - Math.abs(startT * 2 - 1));
        const endY = cornerY - ridgeLift * (1 - Math.abs(endT * 2 - 1));
        const tipBaseY = cornerY - ridgeLift * (1 - Math.abs(tipT * 2 - 1));
        const toothDepth = baseDepth * (0.72 + centerWeight * 0.34);
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.lineTo(tipX, tipBaseY + toothDepth);
        ctx.closePath();
    }
}
function shouldShowDogTongue(displayName, openness, _curvature) {
    if (displayName === "angry") {
        return false;
    }
    if (displayName === "sad" || displayName === "confused") {
        return false;
    }
    if (displayName === "neutral") {
        return false;
    }
    if (displayName === "happy" || displayName === "love" || displayName === "excited") {
        return true;
    }
    return openness > 0.22;
}
export const kibaCharacter = {
    name: "kiba",
    partOptions: {
        eyeShape: ["soft", "wide", "block", "sharp", "sleepy", "droplet"],
        noseShape: ["gem", "pointed", "bridge", "button"],
        mouthShape: ["soft", "band", "block"],
        browShape: ["soft", "bold", "angled"],
    },
    defaultParts: {
        eyeShape: "soft",
        eyeWidthScale: 1,
        eyeHeightScale: 1,
        noseShape: "pointed",
        mouthShape: "soft",
        browShape: "soft",
        scanlineThickness: 5,
        scanlineSpacing: 12,
    },
    defaultStyle: kibaStyle,
    stylePresets: kibaStylePresets,
    lockedStyle: true,
    defaultFeatures: {
        brows: false,
    },
    emotions: kibaEmotions,
    drawBackground(dc, width, height, pose) {
        if (dc.mode !== "face") {
            return;
        }
        const { ctx, theme } = dc;
        const expressionName = dc.emotionName;
        const bobY = pose.global.bob * height * 0.05;
        const bootUpFade = dc.overlayActionName === "bootUp" ? clamp((pose.global.glow - 0.2) / 0.9, 0, 1) : 1;
        const earVisibility = (dc.actionName === "offline" ? 0.22 : dc.actionName === "sleeping" ? 0.68 : 1) * bootUpFade;
        const earGlow = (dc.actionName === "offline" ? 0.28 : 1) * Math.max(0, pose.global.glow) * bootUpFade;
        const earPoses = dc.actionName === "listening"
            ? applyListeningEarLift(resolveEarPoses(expressionName))
            : resolveEarPoses(expressionName);
        const leftEyeMetrics = resolveKibaEyeMetrics(width, height, pose.leftEye, -1, expressionName, dc.style);
        const rightEyeMetrics = resolveKibaEyeMetrics(width, height, pose.rightEye, 1, expressionName, dc.style);
        ctx.save();
        if (dc.actionName === "listening") {
            ctx.rotate(-0.11);
        }
        ctx.strokeStyle = theme.foreground;
        ctx.shadowColor = theme.glow;
        ctx.shadowBlur = Math.max(0, width * 0.024 * earGlow);
        ctx.lineWidth = Math.max(1.5, height * 0.0095);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalAlpha *= earVisibility;
        ctx.save();
        ctx.globalAlpha *= 0.08;
        ctx.fillStyle = theme.foreground;
        ctx.shadowBlur = 0;
        traceEarPath(ctx, width, height, -1, bobY + height * earPoses.leftBob, earPoses.left);
        ctx.fill();
        if (dc.actionName === "listening") {
            traceRaisedListeningEarPath(ctx, width, height, 1, bobY + height * earPoses.rightBob, earPoses.right);
        }
        else {
            traceEarPath(ctx, width, height, 1, bobY + height * earPoses.rightBob, earPoses.right);
        }
        ctx.fill();
        ctx.restore();
        strokeEarOutline(ctx, width, height, -1, bobY + height * earPoses.leftBob, earPoses.left, leftEyeMetrics);
        if (dc.actionName === "listening") {
            traceRaisedListeningEarPath(ctx, width, height, 1, bobY + height * earPoses.rightBob, earPoses.right);
            ctx.stroke();
        }
        else {
            strokeEarOutline(ctx, width, height, 1, bobY + height * earPoses.rightBob, earPoses.right, rightEyeMetrics);
        }
        ctx.save();
        ctx.globalAlpha *= 0.32;
        ctx.lineWidth = Math.max(1.1, height * 0.0058);
        ctx.shadowBlur = 0;
        drawEarFold(ctx, width, height, -1, bobY + height * earPoses.leftBob, earPoses.left);
        if (dc.actionName === "listening") {
            drawRaisedListeningEarFold(ctx, width, height, 1, bobY + height * earPoses.rightBob, earPoses.right);
        }
        else {
            drawEarFold(ctx, width, height, 1, bobY + height * earPoses.rightBob, earPoses.right);
        }
        ctx.restore();
        ctx.restore();
    },
    drawEye(dc, params) {
        const { ctx, theme } = dc;
        const { pose, side, parts, features } = params;
        const expressionName = dc.emotionName;
        const thinkingEyeTilt = dc.actionName === "thinking" && side === 1 ? 0.04 : 0;
        const thinkingEyeShiftY = dc.actionName === "thinking" && side === 1 ? -params.height * 0.022 : 0;
        const thinkingEyeShiftX = dc.actionName === "thinking" && side === 1 ? params.width * 0.008 : 0;
        const thinkingEyeHeightScale = dc.actionName === "thinking" && side === 1 ? 1.08 : 1;
        const thinkingEyeWidthScale = dc.actionName === "thinking" && side === -1 ? 0.94 : 1;
        const listeningTilt = dc.actionName === "listening" ? -0.08 : 0;
        const listeningShiftX = dc.actionName === "listening" ? -params.width * 0.05 : 0;
        const listeningShiftY = dc.actionName === "listening" ? -params.height * 0.02 : 0;
        const eyeMetrics = resolveStandardEyeMetrics({
            width: params.width,
            height: params.height,
            openness: pose.openness,
            squint: pose.squint,
            eyeWidthScale: parts.eyeWidthScale,
            eyeHeightScale: parts.eyeHeightScale,
            widthBase: 0.86,
            widthOpenFactor: 0.14,
            pupilScale: 0.54,
        });
        const { openness, squint } = eyeMetrics;
        const eyeHeight = eyeMetrics.height;
        const eyeWidth = eyeMetrics.width;
        const eyeShape = parts.eyeShape ?? "soft";
        const glyphEye = eyeShape === "sharp" || eyeShape === "sleepy" || eyeShape === "droplet";
        const brightness = clamp(pose.brightness, 0.1, 1.8);
        const confusedTilt = expressionName === "confused";
        const confusedScale = confusedTilt ? (side === -1 ? 1.18 : 0.94) : 1;
        const confusedY = confusedTilt
            ? side === -1
                ? params.height * 0.1
                : -params.height * 0.06
            : 0;
        const confusedX = confusedTilt ? (side === -1 ? -params.width * 0.02 : params.width * 0.01) : 0;
        const excitedWide = expressionName === "excited" ? 1.14 : expressionName === "happy" ? 1.03 : 1;
        const excitedShort = expressionName === "excited" ? 0.92 : 1;
        const resolvedEyeWidth = eyeWidth * confusedScale * excitedWide * thinkingEyeWidthScale;
        const resolvedEyeHeight = eyeHeight * confusedScale * excitedShort * thinkingEyeHeightScale;
        const pupilSize = Math.max(10, eyeMetrics.pupilSize * confusedScale * Math.min(excitedWide, excitedShort));
        const dogSlantBase = expressionName === "sad" ? 0.26 : 0.12;
        const dogSlant = (expressionName === "angry" ? -side : side) * dogSlantBase;
        const headTilt = confusedTilt ? -0.1 : 0;
        ctx.save();
        ctx.translate(params.centerX + confusedX + listeningShiftX + thinkingEyeShiftX, params.centerY + confusedY + listeningShiftY + thinkingEyeShiftY);
        ctx.rotate(dogSlant + pose.tilt * 0.24 + headTilt + listeningTilt + thinkingEyeTilt);
        ctx.globalAlpha *= brightness;
        if (resolvedEyeHeight < params.height * 0.16) {
            ctx.strokeStyle = theme.foreground;
            ctx.lineWidth = Math.max(2, params.height * 0.075);
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(-resolvedEyeWidth * 0.42, 0);
            ctx.quadraticCurveTo(0, resolvedEyeHeight * 0.18, resolvedEyeWidth * 0.42, 0);
            ctx.stroke();
            ctx.restore();
            return;
        }
        ctx.fillStyle = theme.foreground;
        ctx.strokeStyle = theme.foreground;
        ctx.shadowColor = theme.glow;
        ctx.shadowBlur = Math.max(0, Math.min(resolvedEyeWidth, resolvedEyeHeight) * 0.32);
        if (eyeShapeSupportsPupil(eyeShape) || eyeShape === "droplet") {
            ctx.save();
            ctx.globalAlpha *= SOCKET_FILL_ALPHA;
            ctx.fillStyle = theme.foreground;
            ctx.shadowBlur = 0;
            drawDogEyeSocket(ctx, eyeShape, resolvedEyeWidth, resolvedEyeHeight);
            ctx.fill();
            ctx.restore();
        }
        if (glyphEye) {
            drawStandardGlyphEye(ctx, eyeShape, eyeWidth, eyeHeight, side, openness, squint, {
                lineWidthFloor: 1.5,
                sharpLineScale: 0.11,
                sleepyLineScale: 0.13,
            });
        }
        else {
            if (side === -1) {
                ctx.save();
                ctx.globalAlpha *= PATCH_FILL_ALPHA;
                ctx.fillStyle = theme.foreground;
                ctx.shadowBlur = 0;
                ctx.translate(resolvedEyeWidth * 0.11, 0);
                ctx.beginPath();
                ctx.moveTo(-resolvedEyeWidth * 0.48, -resolvedEyeHeight * 0.78);
                ctx.quadraticCurveTo(resolvedEyeWidth * 0.16, -resolvedEyeHeight * 1.04, resolvedEyeWidth * 0.68, -resolvedEyeHeight * 0.4);
                ctx.quadraticCurveTo(resolvedEyeWidth * 0.84, resolvedEyeHeight * 0.08, resolvedEyeWidth * 0.26, resolvedEyeHeight * 0.88);
                ctx.quadraticCurveTo(-resolvedEyeWidth * 0.22, resolvedEyeHeight * 0.96, -resolvedEyeWidth * 0.56, resolvedEyeHeight * 0.34);
                ctx.quadraticCurveTo(-resolvedEyeWidth * 0.72, -resolvedEyeHeight * 0.1, -resolvedEyeWidth * 0.48, -resolvedEyeHeight * 0.72);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }
            drawDogEyeShell(ctx, eyeShape, resolvedEyeWidth, resolvedEyeHeight);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.globalAlpha *= 0.92;
            ctx.fillStyle = theme.accent;
            drawDogEyeShell(ctx, eyeShape, resolvedEyeWidth * 0.82, resolvedEyeHeight * 0.82);
            ctx.fill();
        }
        if (features.pupils && kibaEyeShapeSupportsPupil(eyeShape)) {
            const pupilX = clamp(pose.pupilX, -1, 1) * resolvedEyeWidth * 0.2;
            const pupilY = clamp(pose.pupilY, -1, 1) * resolvedEyeHeight * 0.18;
            const thinkingPupilX = dc.actionName === "thinking" && side === 1 ? -resolvedEyeWidth * 0.035 : 0;
            const thinkingPupilY = dc.actionName === "thinking" && side === 1 ? -resolvedEyeHeight * 0.05 : 0;
            const pupilCenterX = pupilX + (expressionName === "love" ? 0 : thinkingPupilX);
            const pupilCenterY = pupilY + (expressionName === "love" ? 0 : thinkingPupilY);
            const sharpOrSleepyEye = eyeShape === "sharp" || eyeShape === "sleepy";
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
            if (expressionName === "love") {
                const heartPulse = 0.96 + 0.06 * (0.5 + 0.5 * wave(dc.elapsed / 1000, 0.82));
                const lovePupilSize = Math.max(9, Math.min(resolvedEyeWidth, resolvedEyeHeight) * 0.62) * heartPulse;
                ctx.save();
                ctx.fillStyle = LOVE_PUPIL_FILL;
                drawPixelGlyph(ctx, HEART_PATTERN, pupilX, pupilY, lovePupilSize);
                ctx.restore();
            }
            else {
                if (sharpOrSleepyEye) {
                    const irisSize = pupilSize * (eyeShape === "sleepy" ? 1.3 : 1.22);
                    ctx.fillStyle = PUPIL_SHINE_FILL;
                    roundedRect(ctx, pupilCenterX - irisSize * 0.5, pupilCenterY - irisSize * 0.5, irisSize, irisSize, irisSize * 0.5);
                    ctx.fill();
                }
                ctx.fillStyle = PUPIL_FILL;
                roundedRect(ctx, pupilCenterX - pupilSize * 0.5, pupilCenterY - pupilSize * 0.5, pupilSize, pupilSize, pupilSize * 0.28);
                ctx.fill();
            }
            ctx.fillStyle = PUPIL_SHINE_FILL;
            drawPupilShine(ctx, pupilCenterX, pupilCenterY, expressionName === "love"
                ? Math.max(9, Math.min(resolvedEyeWidth, resolvedEyeHeight) * 0.62)
                : pupilSize);
            ctx.fill();
        }
        ctx.restore();
    },
    drawBrow: drawKibaBrow,
    drawNose: drawKibaNose,
    drawMouth(dc, params) {
        const { ctx, theme } = dc;
        const { pose, parts } = params;
        const expressionName = dc.emotionName;
        const suppressTongue = dc.actionName === "sleeping" || dc.actionName === "offline";
        const mouthShape = parts.mouthShape ?? "soft";
        const speakingMotion = dc.speakingAmount > 0.001
            ? clamp(0.02 +
                0.98 *
                    (0.5 + 0.5 * wave(dc.elapsed / 1000, 3.6)) *
                    (0.74 + 0.26 * (0.5 + 0.5 * wave((dc.elapsed + 140) / 1000, 7.4))), 0, 1) * dc.speakingAmount
            : 0;
        const curvature = clamp(pose.curvature + speakingMotion * 0.08, -1, 1);
        const openness = clamp(dc.speakingAmount > 0.001
            ? Math.max(0.02, pose.openness + speakingMotion * 0.98)
            : pose.openness, 0, 1);
        const width = params.width *
            clamp(pose.width * (dc.speakingAmount > 0.001 ? 0.95 + speakingMotion * 0.08 : 1), 0.4, 1.16) *
            (mouthShape === "band" ? 1.08 : mouthShape === "block" ? 0.86 : 1);
        const mouthHeight = params.height * (mouthShape === "band" ? 0.88 : mouthShape === "block" ? 0.92 : 1);
        const brightness = clamp(pose.brightness, 0.1, 1.8);
        const showTeeth = expressionName === "angry";
        const showTongue = dc.speakingAmount > 0.001 || suppressTongue
            ? false
            : shouldShowDogTongue(expressionName, openness, curvature);
        const showSpeakingChatter = !showTeeth && !showTongue && openness > 0.16;
        const pantingEmotion = expressionName === "happy" || expressionName === "love" || expressionName === "excited";
        const tongueOpenness = showTongue && pantingEmotion ? Math.max(openness, 0.66) : openness;
        const tongueCurvature = showTongue && pantingEmotion ? Math.max(curvature, 0.88) : curvature;
        const confusedTilt = expressionName === "confused";
        const mouthStrokeAlpha = showTeeth ? 0 : 0.84;
        const mouthStrokeWidth = Math.max(1.5, params.height * 0.044);
        ctx.save();
        ctx.translate(params.centerX +
            (confusedTilt ? -params.width * 0.015 : 0) +
            (dc.actionName === "listening" ? -params.width * 0.035 : 0), params.centerY +
            (confusedTilt ? params.height * 0.05 : 0) +
            (dc.actionName === "listening" ? -params.height * 0.015 : 0));
        ctx.rotate(pose.tilt * 0.22 + (confusedTilt ? -0.08 : 0) + (dc.actionName === "listening" ? -0.08 : 0));
        ctx.lineWidth = mouthStrokeWidth;
        ctx.strokeStyle = theme.foreground;
        ctx.globalAlpha *= brightness;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.shadowColor = theme.glow;
        ctx.shadowBlur = Math.max(0, params.height * 0.12);
        ctx.save();
        ctx.globalAlpha *= SURFACE_FILL_ALPHA;
        ctx.fillStyle = theme.foreground;
        ctx.shadowBlur = 0;
        drawDogMuzzlePad(ctx, mouthShape, width, mouthHeight, curvature, openness);
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.globalAlpha *= SURFACE_STROKE_ALPHA;
        ctx.shadowBlur = 0;
        drawDogMuzzlePad(ctx, mouthShape, width, mouthHeight, curvature, openness);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.globalAlpha *= DETAIL_LINE_ALPHA;
        ctx.lineWidth = Math.max(1.25, params.height * 0.028);
        ctx.shadowBlur = 0;
        drawDogMuzzleSplit(ctx, width, mouthHeight, showTongue ? tongueCurvature : curvature, showTongue ? tongueOpenness : openness);
        ctx.stroke();
        ctx.restore();
        if (showTeeth) {
            ctx.save();
            ctx.globalAlpha *= 0.98;
            ctx.fillStyle = TOOTH_FILL;
            ctx.shadowBlur = 0;
            drawDogTeeth(ctx, width, params.height, curvature, openness);
            ctx.fill();
            ctx.restore();
        }
        else {
            if (showSpeakingChatter) {
                ctx.save();
                ctx.globalAlpha *= mouthStrokeAlpha * 0.94;
                drawDogSpeakingChatter(ctx, width, mouthHeight, curvature, openness);
                ctx.restore();
            }
            else {
                ctx.save();
                ctx.globalAlpha *= mouthStrokeAlpha * 0.88;
                if (showTongue) {
                    const { lineHalfWidth, tongueHalfWidth, lipY, controlY } = resolveDogTongueGeometry(width, mouthHeight, tongueCurvature, tongueOpenness);
                    const outerMouthHalfWidth = Math.min(lineHalfWidth, Math.max(tongueHalfWidth + width * 0.05, lineHalfWidth * 0.82));
                    strokeDogMouthCurveSpan(ctx, lineHalfWidth, lipY, controlY, -outerMouthHalfWidth, -tongueHalfWidth);
                    strokeDogMouthCurveSpan(ctx, lineHalfWidth, lipY, controlY, tongueHalfWidth, outerMouthHalfWidth);
                }
                else {
                    drawDogMouth(ctx, width, mouthHeight, curvature, openness);
                }
                ctx.restore();
            }
            if (showTongue) {
                ctx.save();
                ctx.fillStyle = TONGUE_FILL;
                ctx.shadowBlur = 0;
                drawDogTongue(ctx, width, mouthHeight, tongueCurvature, tongueOpenness);
                ctx.fill();
                ctx.restore();
                ctx.save();
                ctx.globalAlpha *= mouthStrokeAlpha * 0.88;
                const { tongueHalfWidth, lineHalfWidth, lipY, controlY } = resolveDogTongueGeometry(width, mouthHeight, tongueCurvature, tongueOpenness);
                strokeDogMouthCurveSpan(ctx, lineHalfWidth, lipY, controlY, -tongueHalfWidth, tongueHalfWidth);
                ctx.restore();
                ctx.save();
                ctx.globalAlpha *= DETAIL_LINE_ALPHA;
                drawDogTongueOutline(ctx, width, mouthHeight, tongueCurvature, tongueOpenness);
                ctx.stroke();
                ctx.globalAlpha *= 0.85;
                drawDogTongueSeam(ctx, width, mouthHeight, tongueCurvature, tongueOpenness, pantingEmotion ? 0.12 : 0.18, pantingEmotion ? 0.42 : 0.56, pantingEmotion ? -mouthHeight * 0.008 : 0);
                ctx.stroke();
                ctx.restore();
            }
        }
        ctx.restore();
    },
    getFaceVisibility() {
        return 1;
    },
    getScrambleStrength(_displayName, baseDistortion) {
        return baseDistortion * 0.3;
    },
};
