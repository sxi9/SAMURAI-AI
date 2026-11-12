import { createCapsule, createPlate, traceConstructionCapsule, traceConstructionCurve, traceConstructionDiamond, traceConstructionPlate, traceConstructionQuad, traceConstructionTriangle, } from "./construction.js";
import { clamp } from "./drawUtils.js";
import { drawStandardGlyphEye, eyeShapeSupportsPupil, resolveStandardEyeMetrics, resolveStandardMouthMetrics, resolveStandardNoseMetrics, } from "./standardFace.js";
const DEFAULT_CLOSED_OPEN_DEPTH_THRESHOLD = 1.5;
function assignDefined(target, source) {
    for (const key of Object.keys(source)) {
        if (source[key] !== undefined) {
            target[key] = source[key];
        }
    }
    return target;
}
export function drawStandardEyeShell(ctx, shape, width, height, radius) {
    traceConstructionCapsule(ctx, createCapsule({
        width,
        height,
        y: 0,
        radius: shape === "block" ? 0 : shape === "wide" ? 0.5 : radius / Math.max(1, height),
    }));
}
export function drawStandardNoseShape(ctx, shape, width, height) {
    if (shape === "pointed") {
        traceConstructionTriangle(ctx, width, height);
        ctx.stroke();
        return;
    }
    if (shape === "bridge") {
        traceConstructionCapsule(ctx, createCapsule({
            width: width * 0.24,
            height: height * 0.84,
            y: 0,
            radius: (width * 0.08) / Math.max(1, height * 0.84),
        }));
        ctx.fill();
        return;
    }
    if (shape === "button") {
        traceConstructionCapsule(ctx, createCapsule({
            width: width * 0.32,
            height: height * 0.32,
            y: 0,
            radius: (width * 0.12) / Math.max(1, height * 0.32),
        }));
        ctx.fill();
        return;
    }
    traceConstructionDiamond(ctx, width, height);
    ctx.stroke();
}
export function drawStandardMouthShape(ctx, shape, width, height, lift, openDepth) {
    if (shape === "band") {
        const thickness = Math.max(height * 0.18, openDepth * 0.88 + height * 0.16);
        const leftX = -width * 0.5;
        const rightX = width * 0.5;
        const endDip = lift * 0.18;
        const centerDip = lift * 0.72;
        const skew = Math.max(-height * 0.28, Math.min(height * 0.28, lift * 0.24));
        const topY = -thickness * 0.5;
        const bottomY = thickness * 0.5;
        traceConstructionCurve(ctx, leftX, topY + endDip - skew, 0, topY + centerDip, rightX, topY + endDip + skew);
        ctx.lineTo(rightX, bottomY + endDip + skew);
        ctx.quadraticCurveTo(0, bottomY + centerDip + openDepth * 0.12, leftX, bottomY + endDip - skew);
        ctx.closePath();
        ctx.stroke();
        return;
    }
    if (shape === "block") {
        const barHeight = Math.max(height * 0.12, openDepth * 0.8 + height * 0.08);
        traceConstructionQuad(ctx, [
            [-width * 0.5, -barHeight * 0.35 + lift * 0.18],
            [width * 0.5, -barHeight * 0.35 + lift * 0.18],
            [width * 0.5, barHeight * 0.65 + lift * 0.34],
            [-width * 0.5, barHeight * 0.65 + lift * 0.02],
        ]);
        ctx.stroke();
        return;
    }
    traceConstructionCurve(ctx, -width * 0.5, 0, 0, lift, width * 0.5, 0);
    ctx.stroke();
    if (openDepth > DEFAULT_CLOSED_OPEN_DEPTH_THRESHOLD) {
        ctx.save();
        ctx.globalAlpha *= 0.86;
        traceConstructionCurve(ctx, -width * 0.44, openDepth * 0.18, 0, openDepth - lift * 0.16, width * 0.44, openDepth * 0.18);
        ctx.stroke();
        ctx.restore();
    }
}
export function createStandardEyeRenderer(options = {}) {
    const glyphShapes = new Set(options.glyphShapes ?? ["sharp", "sleepy", "droplet"]);
    return (dc, params) => {
        const { ctx, theme } = dc;
        const { pose, side, style, features, parts } = params;
        const metricOptions = options.resolveMetrics?.(dc, params) ?? {};
        const resolvedEyeMetricOptions = {
            width: params.width,
            height: params.height,
            openness: pose.openness,
            squint: pose.squint,
            eyeWidthScale: parts.eyeWidthScale,
            eyeHeightScale: parts.eyeHeightScale,
        };
        assignDefined(resolvedEyeMetricOptions, metricOptions);
        const eyeMetrics = resolveStandardEyeMetrics(resolvedEyeMetricOptions);
        const { openness, squint } = eyeMetrics;
        const eyeHeight = eyeMetrics.height;
        const eyeWidth = eyeMetrics.width;
        const pupilSize = eyeMetrics.pupilSize;
        const radius = eyeHeight * (options.shellCornerScale ?? style.eyeCorner);
        const brightness = options.resolveBrightness?.(dc, params) ?? clamp(pose.brightness, 0.1, 1.8);
        const strokeWidth = Math.max(options.blinkStrokeMin ?? 2, eyeHeight * (options.blinkStrokeScale ?? 0.08));
        const eyeShape = parts.eyeShape ?? options.defaultShape ?? "soft";
        const glyphEye = glyphShapes.has(eyeShape);
        ctx.save();
        ctx.translate(params.centerX, params.centerY);
        ctx.rotate(options.resolveRotation?.(dc, params) ?? pose.tilt * 0.46);
        if (eyeHeight < params.height * (options.blinkThresholdFactor ?? 0.16)) {
            ctx.lineWidth = strokeWidth;
            ctx.beginPath();
            ctx.moveTo(-eyeWidth * 0.5, 0);
            ctx.lineTo(eyeWidth * 0.5, 0);
            ctx.strokeStyle = theme.foreground;
            ctx.globalAlpha *= brightness;
            ctx.stroke();
            ctx.restore();
            return;
        }
        const faceAlpha = ctx.globalAlpha;
        ctx.globalAlpha *= brightness;
        if (glyphEye) {
            const glyphOptions = {};
            if (options.glyphOptions) {
                assignDefined(glyphOptions, options.glyphOptions);
            }
            drawStandardGlyphEye(ctx, eyeShape, eyeWidth, eyeHeight, side, openness, squint, glyphOptions);
            ctx.restore();
            return;
        }
        drawStandardEyeShell(ctx, eyeShape, eyeWidth, eyeHeight, radius);
        ctx.fill();
        const innerEyeWidth = eyeWidth - strokeWidth * 2;
        const innerEyeHeight = eyeHeight - strokeWidth * 2;
        if (innerEyeWidth > 0 && innerEyeHeight > 0) {
            ctx.globalAlpha *= options.innerFillAlpha ?? 0.35;
            drawStandardEyeShell(ctx, eyeShape, innerEyeWidth, innerEyeHeight, Math.max(2, radius - strokeWidth));
            ctx.fillStyle = theme.accent;
            ctx.fill();
        }
        if (features.pupils && eyeShapeSupportsPupil(eyeShape)) {
            const pupilOffset = options.resolvePupilOffset?.(dc, params, eyeWidth, eyeHeight) ?? {
                x: clamp(pose.pupilX, -1, 1) * eyeWidth * 0.46,
                y: clamp(pose.pupilY, -1, 1) * eyeHeight * 0.42,
            };
            ctx.save();
            ctx.globalAlpha = faceAlpha;
            ctx.fillStyle = options.resolvePupilFill?.(dc, params) ?? "#000000";
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
            traceConstructionCapsule(ctx, createCapsule({
                width: pupilSize,
                height: pupilSize * (0.85 + (1 - openness) * 0.3),
                y: 0,
                radius: 0.28,
            }), pupilOffset.x, pupilOffset.y);
            ctx.fill();
            ctx.restore();
        }
        const lidCut = options.resolveLidCut?.(dc, params, eyeWidth, eyeHeight, squint);
        if ((lidCut ?? 0) > 0.01) {
            ctx.fillStyle = theme.panel;
            ctx.globalAlpha = 0.2 + squint * 0.4;
            ctx.beginPath();
            ctx.moveTo(-eyeWidth * 0.54, -eyeHeight * 0.5);
            ctx.lineTo(eyeWidth * 0.54, -eyeHeight * 0.5 + side * (lidCut ?? 0) * 0.4);
            ctx.lineTo(eyeWidth * 0.54, -eyeHeight * 0.5 + (lidCut ?? 0));
            ctx.lineTo(-eyeWidth * 0.54, -eyeHeight * 0.5 + (lidCut ?? 0) * 1.1);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    };
}
function defaultSoftBrow(ctx, params) {
    traceConstructionCurve(ctx, -params.width * 0.5, 0, 0, 0, params.width * 0.5, 0);
    ctx.stroke();
}
function defaultBoldBrow(ctx, params) {
    traceConstructionCapsule(ctx, createCapsule({
        width: params.width,
        height: params.height,
        y: 0,
        radius: 0.3,
    }));
    ctx.fill();
}
function defaultAngledBrow(ctx, params) {
    traceConstructionPlate(ctx, createPlate({
        width: params.width,
        height: params.height,
        y: 0,
        inset: -0.14,
        taper: 0.3,
        tilt: 0.18,
    }));
    ctx.fill();
}
export function createStandardBrowRenderer(options = {}) {
    return (dc, params) => {
        const { ctx, theme } = dc;
        const shape = params.parts.browShape ?? options.defaultShape ?? "soft";
        const angle = options.resolveAngle?.(dc, params) ?? params.pose.tilt * 0.52;
        const lift = options.resolveLift?.(dc, params) ?? (1 - params.pose.openness) * params.height * 0.4;
        const brightness = options.resolveBrightness?.(dc, params) ?? clamp(params.pose.brightness, 0.1, 1.6) * 0.9;
        ctx.save();
        ctx.translate(params.centerX, params.centerY - lift);
        ctx.rotate(angle);
        ctx.fillStyle = theme.foreground;
        ctx.strokeStyle = theme.foreground;
        ctx.globalAlpha *= brightness;
        ctx.lineWidth = Math.max(2, params.height * 0.7);
        if (shape === "soft") {
            (options.renderSoft ?? defaultSoftBrow)(ctx, params);
            ctx.restore();
            return;
        }
        if (shape === "bold") {
            (options.renderBold ?? defaultBoldBrow)(ctx, params);
            ctx.restore();
            return;
        }
        (options.renderAngled ?? defaultAngledBrow)(ctx, params);
        ctx.restore();
    };
}
export function createStandardNoseRenderer(options = {}) {
    return (dc, params) => {
        const { ctx, theme } = dc;
        const metrics = options.resolveMetrics?.(dc, params) ?? {};
        const noseMetrics = resolveStandardNoseMetrics({
            width: params.width,
            height: params.height,
            scale: metrics.scale ?? params.pose.scale,
        });
        const width = noseMetrics.width;
        const height = noseMetrics.height;
        const brightness = options.resolveBrightness?.(dc, params) ?? clamp(params.pose.brightness, 0.1, 1.6) * 0.92;
        const rotation = options.resolveRotation?.(dc, params) ?? params.pose.tilt * 0.5;
        const offset = options.resolveOffset?.(dc, params) ?? { x: 0, y: 0 };
        ctx.save();
        ctx.translate(params.centerX + offset.x, params.centerY + offset.y);
        ctx.rotate(rotation);
        ctx.lineWidth = Math.max(2, width * 0.08);
        ctx.strokeStyle = theme.foreground;
        ctx.fillStyle = theme.foreground;
        ctx.globalAlpha *= brightness;
        options.configureContext?.(ctx, dc, params, width, height);
        (options.renderShape ?? drawStandardNoseShape)(ctx, params.parts.noseShape ?? options.defaultShape ?? "gem", width, height);
        ctx.restore();
    };
}
export function createStandardMouthRenderer(options = {}) {
    return (dc, params) => {
        const { ctx, theme } = dc;
        const metricOptions = options.resolveMetrics?.(dc, params) ?? {};
        const resolvedMouthMetricOptions = {
            width: params.width,
            height: params.height,
            openness: params.pose.openness,
            curvature: params.pose.curvature,
            widthScale: metricOptions.widthScale ?? params.pose.width,
        };
        assignDefined(resolvedMouthMetricOptions, metricOptions);
        const mouthMetrics = resolveStandardMouthMetrics(resolvedMouthMetricOptions);
        const brightness = options.resolveBrightness?.(dc, params) ?? clamp(params.pose.brightness, 0.1, 1.8);
        const rotation = options.resolveRotation?.(dc, params) ?? params.pose.tilt * 0.26;
        const closedMouth = mouthMetrics.openDepth <=
            (options.closedOpenDepthThreshold ?? DEFAULT_CLOSED_OPEN_DEPTH_THRESHOLD);
        ctx.save();
        ctx.translate(params.centerX, params.centerY);
        ctx.rotate(rotation);
        ctx.lineWidth = closedMouth
            ? Math.max(options.closedLineWidthMin ?? 3, params.height * (options.closedLineWidthScale ?? 0.12))
            : Math.max(options.openLineWidthMin ?? 2, params.height * (options.openLineWidthScale ?? 0.08));
        ctx.strokeStyle = theme.foreground;
        ctx.fillStyle = theme.foreground;
        ctx.globalAlpha *= brightness * (closedMouth ? (options.closedBrightnessScale ?? 1.08) : 1);
        if (closedMouth) {
            ctx.shadowBlur *= options.closedShadowScale ?? 1.2;
        }
        (options.renderShape ?? drawStandardMouthShape)(ctx, params.parts.mouthShape ?? options.defaultShape ?? "soft", mouthMetrics.width, params.height, mouthMetrics.lift, mouthMetrics.openDepth);
        ctx.restore();
    };
}
