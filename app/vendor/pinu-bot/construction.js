import { roundedRect } from "./drawUtils.js";
const DEFAULT_LAYOUT = {
    eyeGap: 0.22,
    eyeLineY: -0.02,
    centerlineBias: 0,
};
export function createConstructionFrame(width, height, options = {}) {
    return {
        width,
        height,
        centerX: options.centerX ?? 0,
        centerY: options.centerY ?? 0,
    };
}
export function createConstructionLayout(overrides = {}) {
    return {
        eyeGap: overrides.eyeGap ?? DEFAULT_LAYOUT.eyeGap,
        eyeLineY: overrides.eyeLineY ?? DEFAULT_LAYOUT.eyeLineY,
        centerlineBias: overrides.centerlineBias ?? DEFAULT_LAYOUT.centerlineBias,
    };
}
export function createStyleConstructionLayout(style, overrides = {}) {
    const layoutOverrides = {
        // style.eyeGap is center-to-eye; layout.eyeGap is the full eye-to-eye span
        eyeGap: style.eyeGap * 2,
        eyeLineY: style.eyeY,
    };
    if (overrides.centerlineBias !== undefined) {
        layoutOverrides.centerlineBias = overrides.centerlineBias;
    }
    return createConstructionLayout(layoutOverrides);
}
export function resolveConstructionAnchors(frame, layout) {
    const centerX = frame.centerX + frame.width * layout.centerlineBias;
    const eyeOffset = frame.width * layout.eyeGap * 0.5;
    return {
        centerX,
        centerY: frame.centerY,
        eyeLineY: frame.centerY + frame.height * layout.eyeLineY,
        leftEyeX: centerX - eyeOffset,
        rightEyeX: centerX + eyeOffset,
    };
}
export function resolveEyeAnchor(anchors, side) {
    return {
        x: side === "left" ? anchors.leftEyeX : anchors.rightEyeX,
        y: anchors.eyeLineY,
    };
}
export function createPlate(config) {
    return {
        kind: "plate",
        width: config.width,
        height: config.height,
        y: config.y,
        inset: config.inset ?? 0,
        taper: config.taper ?? 0,
        tilt: config.tilt ?? 0,
    };
}
export function createCapsule(config) {
    return {
        kind: "capsule",
        width: config.width,
        height: config.height,
        y: config.y,
        radius: config.radius ?? 0.5,
    };
}
export function createNotch(config) {
    return {
        kind: "notch",
        width: config.width,
        height: config.height,
        y: config.y,
    };
}
export function createWedge(config) {
    return {
        kind: "wedge",
        width: config.width,
        height: config.height,
        y: config.y,
        spread: config.spread ?? 0.28,
    };
}
/**
 * Traces a capsule (rounded rectangle) path. Unlike {@link traceConstructionPlate},
 * this applies offsets arithmetically rather than via canvas transforms,
 * so it does not call save/restore.
 */
export function traceConstructionCapsule(ctx, shape, centerX = 0, centerY = 0) {
    roundedRect(ctx, centerX - shape.width * 0.5, centerY + shape.y - shape.height * 0.5, shape.width, shape.height, shape.height * shape.radius);
}
/**
 * Traces a plate (tapered quadrilateral) path. Uses save/restore because the
 * plate's tilt requires a canvas rotation transform.
 */
export function traceConstructionPlate(ctx, shape, centerX = 0, centerY = 0) {
    const halfWidth = shape.width * 0.5;
    const halfHeight = shape.height * 0.5;
    const taperOffset = shape.width * shape.taper * 0.5;
    const insetOffset = shape.width * shape.inset * 0.5;
    ctx.save();
    ctx.translate(centerX, centerY + shape.y);
    ctx.rotate(shape.tilt);
    ctx.beginPath();
    ctx.moveTo(-halfWidth + insetOffset, -halfHeight);
    ctx.lineTo(halfWidth - insetOffset, -halfHeight);
    ctx.lineTo(halfWidth - taperOffset, halfHeight);
    ctx.lineTo(-halfWidth + taperOffset, halfHeight);
    ctx.closePath();
    ctx.restore();
}
export function traceConstructionCurve(ctx, startX, startY, controlX, controlY, endX, endY) {
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(controlX, controlY, endX, endY);
}
export function traceConstructionChevron(ctx, leftX, leftY, apexX, apexY, rightX, rightY) {
    ctx.beginPath();
    ctx.moveTo(leftX, leftY);
    ctx.lineTo(apexX, apexY);
    ctx.lineTo(rightX, rightY);
}
export function traceConstructionDroplet(ctx, width, height, shoulderXRatio = 0.28) {
    const topY = -height * 0.48;
    const bottomY = height * 0.48;
    const shoulderX = width * shoulderXRatio;
    ctx.beginPath();
    ctx.moveTo(0, topY);
    ctx.bezierCurveTo(shoulderX, -height * 0.28, shoulderX, height * 0.16, 0, bottomY);
    ctx.bezierCurveTo(-shoulderX, height * 0.16, -shoulderX, -height * 0.28, 0, topY);
    ctx.closePath();
}
export function traceConstructionDiamond(ctx, width, height) {
    ctx.beginPath();
    ctx.moveTo(0, -height * 0.4);
    ctx.lineTo(width * 0.36, 0);
    ctx.lineTo(0, height * 0.48);
    ctx.lineTo(-width * 0.36, 0);
    ctx.closePath();
}
export function traceConstructionTriangle(ctx, width, height, shoulderRatio = 0.36) {
    ctx.beginPath();
    ctx.moveTo(0, -height * 0.42);
    ctx.lineTo(width * shoulderRatio, height * 0.42);
    ctx.lineTo(-width * shoulderRatio, height * 0.42);
    ctx.closePath();
}
export function traceConstructionQuad(ctx, points) {
    const [firstPoint, ...restPoints] = points;
    if (!firstPoint) {
        return;
    }
    ctx.beginPath();
    ctx.moveTo(firstPoint[0], firstPoint[1]);
    for (const [x, y] of restPoints) {
        ctx.lineTo(x, y);
    }
    ctx.closePath();
}
