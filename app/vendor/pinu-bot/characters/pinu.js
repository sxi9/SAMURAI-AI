import { clamp, drawPixelGlyph, ease, HEART_PATTERN, roundedRect, wave } from "../drawUtils.js";
import { createStandardBrowRenderer, createStandardEyeRenderer, createStandardMouthRenderer, createStandardNoseRenderer, } from "../standardRobotRenderers.js";
import { STYLE_PRESETS } from "../styles.js";
function resolveLoveTransitionProgress(dc) {
    if (dc.displayName !== "love") {
        return -1;
    }
    const elapsed = dc.elapsed - dc.emotionFromTime;
    if (elapsed < 0) {
        return -1;
    }
    const durationMs = 1180;
    if (elapsed > durationMs) {
        return -1;
    }
    return clamp(elapsed / durationMs, 0, 1);
}
const drawPinuEye = createStandardEyeRenderer({
    defaultShape: "soft",
    resolveMetrics: (_dc, params) => ({
        widthBase: 0.82,
        widthOpenFactor: 0.14,
        pupilScale: params.style.pupilScale,
    }),
    resolveRotation: (dc, params) => {
        const thinkingLift = dc.actionName === "thinking" && params.side === 1 ? -0.18 : 0;
        return params.pose.tilt * 0.46 + thinkingLift;
    },
    resolveBrightness: (_dc, params) => clamp(params.pose.brightness, 0.1, 1.8),
    resolvePupilFill: (dc) => (dc.displayName === "angry" ? "#565d66" : "#000000"),
    resolvePupilOffset: (dc, params, eyeWidth, eyeHeight) => {
        if (dc.actionName === "thinking") {
            const sweep = wave((dc.elapsed + 220) / 1000, 0.22);
            const jitter = wave((dc.elapsed + 80) / 1000, 0.73);
            return {
                x: (sweep * 0.78 + jitter * 0.22) * eyeWidth * 0.38,
                y: (-0.2 - 0.14 * jitter) * eyeHeight,
            };
        }
        return {
            x: clamp(params.pose.pupilX, -1, 1) * eyeWidth * 0.46,
            y: clamp(params.pose.pupilY, -1, 1) * eyeHeight * 0.42,
        };
    },
    resolveLidCut: (_dc, _params, _eyeWidth, eyeHeight, squint) => eyeHeight * squint * 0.24,
    glyphOptions: {
        lineWidthFloor: 3,
        sharpLineScale: 0.18,
        sleepyLineScale: 0.2,
    },
    innerFillAlpha: 0.35,
    blinkThresholdFactor: 0.16,
    blinkStrokeMin: 2,
    blinkStrokeScale: 0.08,
});
const drawPinuBrow = createStandardBrowRenderer({
    defaultShape: "soft",
    resolveAngle: (dc, params) => {
        const baseAngle = params.pose.tilt * 0.52 + params.pose.squint * 0.18 * -params.side;
        if (dc.displayName === "confused") {
            return params.side === -1 ? -0.2 : -0.08;
        }
        if (dc.actionName === "thinking" && params.side === 1) {
            return baseAngle - 0.12;
        }
        return baseAngle;
    },
    resolveLift: (dc, params) => {
        const baseLift = (1 - params.pose.openness) * params.height * 0.4;
        if (dc.actionName === "thinking" && params.side === 1) {
            return baseLift + params.height * 0.72;
        }
        return baseLift;
    },
    resolveBrightness: (_dc, params) => clamp(params.pose.brightness, 0.1, 1.6) * 0.9,
});
const drawPinuNose = createStandardNoseRenderer({
    defaultShape: "gem",
    resolveBrightness: (_dc, params) => clamp(params.pose.brightness, 0.1, 1.6) * 0.92,
    resolveRotation: (_dc, params) => params.pose.tilt * 0.5,
});
const drawPinuMouth = createStandardMouthRenderer({
    defaultShape: "soft",
    resolveBrightness: (_dc, params) => clamp(params.pose.brightness, 0.1, 1.8),
    resolveRotation: (_dc, params) => params.pose.tilt * 0.26,
    closedOpenDepthThreshold: 1.5,
    closedLineWidthMin: 3,
    closedLineWidthScale: 0.12,
    openLineWidthMin: 2,
    openLineWidthScale: 0.08,
    closedBrightnessScale: 1.08,
    closedShadowScale: 1.2,
});
export const pinuCharacter = {
    name: "pinu",
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
        noseShape: "bridge",
        mouthShape: "soft",
        browShape: "soft",
        scanlineThickness: 1.5,
        scanlineSpacing: 5,
    },
    defaultStyle: STYLE_PRESETS.classic,
    drawEye: drawPinuEye,
    drawBrow: drawPinuBrow,
    drawNose: drawPinuNose,
    drawMouth: drawPinuMouth,
    drawOverlay(dc, width, height, pose) {
        const progress = resolveLoveTransitionProgress(dc);
        if (progress < 0 || dc.mode !== "face") {
            return;
        }
        const { ctx, theme } = dc;
        let heartAlpha = 0;
        let swell = 0;
        if (progress >= 0.08 && progress < 0.28) {
            const t = ease("smooth", (progress - 0.08) / 0.2);
            heartAlpha = t;
            swell = t;
        }
        else if (progress >= 0.28 && progress < 0.76) {
            const holdPulse = 0.92 + 0.08 * (0.5 + 0.5 * wave(dc.elapsed / 1000, 3.2));
            heartAlpha = 1;
            swell = holdPulse;
        }
        else if (progress >= 0.76 && progress < 0.92) {
            const t = 1 - ease("smooth", (progress - 0.76) / 0.16);
            heartAlpha = t;
            swell = 0.92 + t * 0.18;
        }
        if (heartAlpha <= 0.001) {
            return;
        }
        const heartSize = Math.min(width, height) * (0.12 + 0.2 * swell);
        const washAlpha = heartAlpha * 0.12;
        const centerY = -height * 0.05 + pose.global.bob * height * 0.05;
        ctx.save();
        ctx.globalAlpha *= washAlpha;
        ctx.fillStyle = theme.panel;
        roundedRect(ctx, -width * 0.24, -height * 0.26 + pose.global.bob * height * 0.06, width * 0.48, height * 0.38, Math.min(width, height) * 0.06);
        ctx.fill();
        ctx.shadowColor = "#ff7b98";
        ctx.shadowBlur = heartSize * 0.4;
        ctx.globalAlpha = heartAlpha;
        ctx.fillStyle = "#ff305f";
        drawPixelGlyph(ctx, HEART_PATTERN, 0, centerY, heartSize);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = heartAlpha * 0.3;
        ctx.fillStyle = "#ff9ab3";
        drawPixelGlyph(ctx, HEART_PATTERN, 0, centerY - heartSize * 0.04, heartSize * 0.62);
        ctx.restore();
    },
    getFaceVisibility(dc) {
        const progress = resolveLoveTransitionProgress(dc);
        if (progress < 0) {
            return 1;
        }
        if (progress < 0.14) {
            return 1 - ease("smooth", progress / 0.14);
        }
        if (progress < 0.82) {
            return 0;
        }
        return ease("smooth", (progress - 0.82) / 0.18);
    },
    getScrambleStrength(displayName, baseDistortion) {
        const angryStrength = displayName === "angry" ? 0.16 : 0;
        return Math.max(angryStrength, baseDistortion * 0.7);
    },
};
