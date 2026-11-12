import { clamp } from "./drawUtils.js";
export function eyeShapeSupportsPupil(shape) {
    return shape === "soft" || shape === "wide" || shape === "block";
}
export function drawStandardGlyphEye(ctx, shape, width, height, side, openness, squint, options = {}) {
    if (shape === "sharp") {
        const lineWidth = Math.max(options.lineWidthFloor ?? 3, Math.min(width, height) * (options.sharpLineScale ?? 0.18));
        const apexX = side * width * 0.04;
        const apexY = -height * (0.3 + squint * 0.08);
        const wingY = height * (0.08 + (1 - openness) * 0.12);
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(-width * 0.42, wingY);
        ctx.lineTo(apexX, apexY);
        ctx.lineTo(width * 0.42, wingY);
        ctx.stroke();
        return;
    }
    if (shape === "sleepy") {
        const lineWidth = Math.max(options.lineWidthFloor ?? 3, Math.min(width, height) * (options.sleepyLineScale ?? 0.2));
        const startX = -side * width * 0.08;
        const controlX = side * width * 0.42;
        const arcHeight = height * (0.42 + (1 - openness) * 0.08);
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(startX, -arcHeight);
        ctx.quadraticCurveTo(controlX, 0, startX, arcHeight);
        ctx.stroke();
        return;
    }
    if (shape === "droplet") {
        const topY = -height * 0.48;
        const bottomY = height * 0.48;
        const shoulderX = width * 0.28;
        ctx.beginPath();
        ctx.moveTo(0, topY);
        ctx.bezierCurveTo(shoulderX, -height * 0.28, shoulderX, height * 0.16, 0, bottomY);
        ctx.bezierCurveTo(-shoulderX, height * 0.16, -shoulderX, -height * 0.28, 0, topY);
        ctx.closePath();
        ctx.fill();
    }
}
export function resolveStandardEyeMetrics(options) {
    const openness = clamp(options.openness, 0.01, 1);
    const squint = clamp(options.squint, 0, 1);
    const eyeWidthScale = clamp(options.eyeWidthScale ?? 1, 0.5, 1.8);
    const eyeHeightScale = clamp(options.eyeHeightScale ?? 1, 0.5, 1.8);
    const baseWidth = options.width * eyeWidthScale;
    const baseHeight = options.height * eyeHeightScale;
    const height = Math.max(baseHeight * (options.minHeightFactor ?? 0.1), baseHeight *
        ((options.opennessBase ?? 0.18) + openness * (options.opennessFactor ?? 0.74)) *
        (1 - squint * (options.squintFactor ?? 0.52)));
    const width = baseWidth * ((options.widthBase ?? 0.82) + openness * (options.widthOpenFactor ?? 0.14));
    const pupilSize = Math.max(4, Math.min(width, height) * (options.pupilScale ?? 0.24));
    return {
        openness,
        squint,
        eyeWidthScale,
        eyeHeightScale,
        baseWidth,
        baseHeight,
        width,
        height,
        pupilSize,
    };
}
export function resolveStandardNoseMetrics(options) {
    const scale = clamp(options.scale, 0.1, 1.5);
    return {
        scale,
        width: options.width * scale,
        height: options.height * scale,
    };
}
export function resolveStandardMouthMetrics(options) {
    const curvature = clamp(options.curvature, -1, 1);
    const openness = clamp(options.openness, 0, 1);
    const width = options.width *
        clamp(options.widthScale, options.widthClampMin ?? 0.2, options.widthClampMax ?? 1.2);
    const lift = curvature * options.height * (options.liftScale ?? 0.6);
    const openDepth = openness * options.height * (options.openDepthScale ?? 0.8);
    return {
        openness,
        curvature,
        width,
        lift,
        openDepth,
    };
}
