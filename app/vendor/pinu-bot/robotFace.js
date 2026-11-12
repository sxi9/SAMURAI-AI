import { ACTION_DEFINITIONS } from "./actions.js";
import { getCharacter, registerCharacter } from "./character.js";
import { buboCharacter, kibaCharacter, pinuCharacter } from "./characters/index.js";
import { createConstructionFrame, createStyleConstructionLayout, resolveConstructionAnchors, } from "./construction.js";
import { clamp, drawPixelGlyph, ease, HEART_PATTERN, roundedRect, wave } from "./drawUtils.js";
import { EMOTIONS } from "./emotions.js";
import { FACE_THEMES } from "./faceThemes.js";
import { FACE_FEATURE_DEFAULTS, PART_STYLE_DEFAULTS, STYLE_PRESETS } from "./styles.js";
import { THEMES } from "./themes.js";
registerCharacter(pinuCharacter);
registerCharacter(kibaCharacter);
registerCharacter(buboCharacter);
const UNSET = Number.NaN;
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (current, target, dt, speed) => lerp(current, target, 1 - Math.exp(-speed * dt));
const createPose = () => ({
    leftEye: { openness: 0, squint: 0, tilt: 0, pupilX: 0, pupilY: 0, brightness: 1 },
    rightEye: { openness: 0, squint: 0, tilt: 0, pupilX: 0, pupilY: 0, brightness: 1 },
    nose: { scale: 1, tilt: 0, brightness: 1 },
    mouth: { openness: 0, curvature: 0, width: 1, tilt: 0, brightness: 1 },
    global: { glow: 1, bob: 0, jitter: 0, distortion: 0, flicker: 0, scanline: 0 },
});
const createUnsetPose = () => ({
    leftEye: {
        openness: UNSET,
        squint: UNSET,
        tilt: UNSET,
        pupilX: UNSET,
        pupilY: UNSET,
        brightness: UNSET,
    },
    rightEye: {
        openness: UNSET,
        squint: UNSET,
        tilt: UNSET,
        pupilX: UNSET,
        pupilY: UNSET,
        brightness: UNSET,
    },
    nose: { scale: UNSET, tilt: UNSET, brightness: UNSET },
    mouth: { openness: UNSET, curvature: UNSET, width: UNSET, tilt: UNSET, brightness: UNSET },
    global: {
        glow: UNSET,
        bob: UNSET,
        jitter: UNSET,
        distortion: UNSET,
        flicker: UNSET,
        scanline: UNSET,
    },
});
const copyPose = (target, source) => {
    Object.assign(target.leftEye, source.leftEye);
    Object.assign(target.rightEye, source.rightEye);
    Object.assign(target.nose, source.nose);
    Object.assign(target.mouth, source.mouth);
    Object.assign(target.global, source.global);
};
const lerpPose = (target, from, to, t) => {
    lerpEye(target.leftEye, from.leftEye, to.leftEye, t);
    lerpEye(target.rightEye, from.rightEye, to.rightEye, t);
    lerpNose(target.nose, from.nose, to.nose, t);
    lerpMouth(target.mouth, from.mouth, to.mouth, t);
    lerpGlobal(target.global, from.global, to.global, t);
};
const lerpEye = (target, from, to, t) => {
    target.openness = lerp(from.openness, to.openness, t);
    target.squint = lerp(from.squint, to.squint, t);
    target.tilt = lerp(from.tilt, to.tilt, t);
    target.pupilX = lerp(from.pupilX, to.pupilX, t);
    target.pupilY = lerp(from.pupilY, to.pupilY, t);
    target.brightness = lerp(from.brightness, to.brightness, t);
};
const lerpNose = (target, from, to, t) => {
    target.scale = lerp(from.scale, to.scale, t);
    target.tilt = lerp(from.tilt, to.tilt, t);
    target.brightness = lerp(from.brightness, to.brightness, t);
};
const lerpMouth = (target, from, to, t) => {
    target.openness = lerp(from.openness, to.openness, t);
    target.curvature = lerp(from.curvature, to.curvature, t);
    target.width = lerp(from.width, to.width, t);
    target.tilt = lerp(from.tilt, to.tilt, t);
    target.brightness = lerp(from.brightness, to.brightness, t);
};
const lerpGlobal = (target, from, to, t) => {
    target.glow = lerp(from.glow, to.glow, t);
    target.bob = lerp(from.bob, to.bob, t);
    target.jitter = lerp(from.jitter, to.jitter, t);
    target.distortion = lerp(from.distortion, to.distortion, t);
    target.flicker = lerp(from.flicker, to.flicker, t);
    target.scanline = lerp(from.scanline, to.scanline, t);
};
const blendPoseFromNeutral = (emotion, intensity, target) => {
    const neutral = EMOTIONS.neutral.pose;
    lerpPose(target, neutral, emotion, clamp(intensity, 0, 1));
};
const overrideValue = (base, value) => (Number.isNaN(value) ? base : value);
const applyOverrides = (target, overrides) => {
    target.leftEye.openness = overrideValue(target.leftEye.openness, overrides.leftEye.openness);
    target.leftEye.squint = overrideValue(target.leftEye.squint, overrides.leftEye.squint);
    target.leftEye.tilt = overrideValue(target.leftEye.tilt, overrides.leftEye.tilt);
    target.leftEye.pupilX = overrideValue(target.leftEye.pupilX, overrides.leftEye.pupilX);
    target.leftEye.pupilY = overrideValue(target.leftEye.pupilY, overrides.leftEye.pupilY);
    target.leftEye.brightness = overrideValue(target.leftEye.brightness, overrides.leftEye.brightness);
    target.rightEye.openness = overrideValue(target.rightEye.openness, overrides.rightEye.openness);
    target.rightEye.squint = overrideValue(target.rightEye.squint, overrides.rightEye.squint);
    target.rightEye.tilt = overrideValue(target.rightEye.tilt, overrides.rightEye.tilt);
    target.rightEye.pupilX = overrideValue(target.rightEye.pupilX, overrides.rightEye.pupilX);
    target.rightEye.pupilY = overrideValue(target.rightEye.pupilY, overrides.rightEye.pupilY);
    target.rightEye.brightness = overrideValue(target.rightEye.brightness, overrides.rightEye.brightness);
    target.nose.scale = overrideValue(target.nose.scale, overrides.nose.scale);
    target.nose.tilt = overrideValue(target.nose.tilt, overrides.nose.tilt);
    target.nose.brightness = overrideValue(target.nose.brightness, overrides.nose.brightness);
    target.mouth.openness = overrideValue(target.mouth.openness, overrides.mouth.openness);
    target.mouth.curvature = overrideValue(target.mouth.curvature, overrides.mouth.curvature);
    target.mouth.width = overrideValue(target.mouth.width, overrides.mouth.width);
    target.mouth.tilt = overrideValue(target.mouth.tilt, overrides.mouth.tilt);
    target.mouth.brightness = overrideValue(target.mouth.brightness, overrides.mouth.brightness);
    target.global.glow = overrideValue(target.global.glow, overrides.global.glow);
    target.global.bob = overrideValue(target.global.bob, overrides.global.bob);
    target.global.jitter = overrideValue(target.global.jitter, overrides.global.jitter);
    target.global.distortion = overrideValue(target.global.distortion, overrides.global.distortion);
    target.global.flicker = overrideValue(target.global.flicker, overrides.global.flicker);
    target.global.scanline = overrideValue(target.global.scanline, overrides.global.scanline);
};
const clearPose = (pose) => {
    copyPose(pose, createUnsetPose());
};
const resolveTheme = (theme) => typeof theme === "string" ? THEMES[theme] : theme;
const resolveStyle = (style) => typeof style === "string" ? STYLE_PRESETS[style] : style;
const findStylePresetName = (style) => {
    const entries = Object.entries(STYLE_PRESETS);
    for (const [name, preset] of entries) {
        if (preset === style) {
            return name;
        }
    }
    return null;
};
const canApplyLockedCharacterThemeStyle = (character, style) => {
    return !character.lockedStyle || typeof style === "string" || findStylePresetName(style) !== null;
};
const resolveCharacterStyle = (character, style) => {
    const presetName = typeof style === "string" ? style : findStylePresetName(style);
    if (presetName && character.stylePresets?.[presetName]) {
        return character.stylePresets[presetName];
    }
    return resolveStyle(style);
};
const normalizeFeatures = (features) => {
    const anyEyeVisible = features.leftEye || features.rightEye;
    if (anyEyeVisible) {
        return features;
    }
    return {
        ...features,
        brows: false,
        pupils: false,
    };
};
const mergeFeatures = (base, update) => normalizeFeatures({
    ...base,
    ...update,
});
const mergeParts = (base, update) => ({
    ...base,
    ...update,
});
const resolveFaceTheme = (faceTheme) => typeof faceTheme === "string" ? FACE_THEMES[faceTheme] : faceTheme;
const resolveCharacter = (character) => {
    if (typeof character === "string") {
        const found = getCharacter(character);
        if (!found) {
            throw new Error(`Unknown character: "${character}". Register it with registerCharacter().`);
        }
        return found;
    }
    return character;
};
const resolveCharacterParts = (character) => {
    return mergeParts(PART_STYLE_DEFAULTS, character.defaultParts);
};
const normalizePixelRatio = (value) => {
    if (value === undefined) {
        return undefined;
    }
    return Math.max(1, Number.isFinite(value) ? value : 1);
};
const DEFAULT_BACKGROUND_FX = {
    mode: "off",
    color: "#ffb36b",
    intensity: 0.22,
    pulseHz: 0.9,
};
const EMOTION_BACKGROUND_FX = {
    happy: { color: "#ffcf76", intensity: 0.18, pulseHz: 1.1 },
    love: { color: "#ff7ea8", intensity: 0.22, pulseHz: 1.2 },
    sad: { color: "#5e89d6", intensity: 0.16, pulseHz: 0.45 },
    angry: { color: "#ff1408", intensity: 0.36, pulseHz: 2.35 },
    surprised: { color: "#fff2b1", intensity: 0.2, pulseHz: 1.6 },
    confused: { color: "#8bcbff", intensity: 0.17, pulseHz: 0.8 },
    excited: { color: "#ffd86d", intensity: 0.24, pulseHz: 2.3 },
};
const ACTION_BACKGROUND_FX = {
    thinking: { color: "#9ab0ff", intensity: 0.16, pulseHz: 0.55 },
    listening: { color: "#7de8ff", intensity: 0.14, pulseHz: 0.8 },
    sleeping: { color: "#6787b0", intensity: 0.12, pulseHz: 0.3 },
    offline: { color: "#34404f", intensity: 0.12, pulseHz: 0.2 },
};
const OVERLAY_ACTION_BACKGROUND_FX = {
    bootUp: { color: "#a8d7ff", intensity: 0.2, pulseHz: 2.1 },
    glitch: { color: "#ff789a", intensity: 0.26, pulseHz: 7 },
};
const EMOTION_SYMBOLS = {
    love: "heart",
    confused: "question",
    surprised: "exclamation",
};
const ACTION_SYMBOLS = {
    thinking: "ellipsis",
    offline: "offline",
};
const OVERLAY_ACTION_SYMBOLS = {
    bootUp: "loading",
    glitch: "warning",
};
const PIXEL_SYMBOL_PATTERNS = {
    question: [
        "00111100",
        "01100110",
        "00000110",
        "00001100",
        "00011000",
        "00000000",
        "00011000",
        "00000000",
    ],
    exclamation: [
        "0000001100",
        "0010001100",
        "0010001100",
        "0010001100",
        "0010001100",
        "0010001100",
        "0000000000",
        "0000000000",
        "0010001100",
        "0000000000",
    ],
    ellipsis: [
        "0000000000",
        "0000000000",
        "0000000000",
        "0000000000",
        "0000000000",
        "1100110011",
        "1100110011",
        "0000000000",
    ],
    heart: HEART_PATTERN,
    offline: [
        "0000000011111100",
        "0000000000001100",
        "0000000000011000",
        "0000000000110000",
        "0000000001100000",
        "0000000011111100",
        "0000000000000000",
        "0000011110000000",
        "0000000110000000",
        "0000001100000000",
        "0000011110000000",
        "0000000000000000",
        "0011100000000000",
        "0000100000000000",
        "0001000000000000",
        "0011100000000000",
    ],
    warning: [
        "000001100000",
        "000011110000",
        "000110011000",
        "000110011000",
        "001110011100",
        "001110011100",
        "011110011110",
        "011111111110",
        "111110011111",
        "111111111111",
        "111111111111",
    ],
};
const PIXEL_LOADING_BAR = ["111", "111", "111", "111", "000", "000"];
const DEFAULT_ACTION_DURATION_MS = {
    thinking: 2400,
    listening: 2200,
    sleeping: 3600,
    offline: 2600,
};
const DEFAULT_OVERLAY_ACTION_DURATION_MS = {
    bootUp: 1450,
    glitch: 900,
};
const ACTION_BLEND_STRENGTH = {
    thinking: 0.52,
    listening: 0.78,
    sleeping: 0.84,
    offline: 1,
};
const ACTION_BLEND_SPEED = {
    thinking: 10,
    listening: 11,
    sleeping: 8,
    offline: 7,
};
const resolveBackgroundFx = (config) => {
    if (!config) {
        return { ...DEFAULT_BACKGROUND_FX };
    }
    if (typeof config === "string") {
        return { ...DEFAULT_BACKGROUND_FX, mode: config };
    }
    return {
        ...DEFAULT_BACKGROUND_FX,
        ...config,
        mode: config.mode ?? DEFAULT_BACKGROUND_FX.mode,
    };
};
const neutralMouth = EMOTIONS.neutral.pose.mouth;
const mouthPreset = (kind, amount, options = {}) => {
    const t = clamp(amount, 0, 1);
    const open = options.open ?? false;
    if (kind === "smile") {
        return {
            openness: lerp(neutralMouth.openness, open ? 0.08 : 0.01, t),
            curvature: lerp(neutralMouth.curvature, 0.56, t),
            width: lerp(neutralMouth.width, 0.96, t),
            tilt: lerp(neutralMouth.tilt, 0, t),
            brightness: lerp(neutralMouth.brightness, 1.04, t),
        };
    }
    if (kind === "frown") {
        return {
            openness: lerp(neutralMouth.openness, open ? 0.08 : 0.01, t),
            curvature: lerp(neutralMouth.curvature, -0.56, t),
            width: lerp(neutralMouth.width, 0.94, t),
            tilt: lerp(neutralMouth.tilt, 0, t),
            brightness: lerp(neutralMouth.brightness, 1.02, t),
        };
    }
    return {
        openness: lerp(neutralMouth.openness, open ? 0.08 : 0.03, t),
        curvature: lerp(neutralMouth.curvature, -0.02, t),
        width: lerp(neutralMouth.width, 0.44, t),
        tilt: lerp(neutralMouth.tilt, 0, t),
        brightness: lerp(neutralMouth.brightness, 1.04, t),
    };
};
const assignPartialPose = (target, value) => {
    if (value.leftEye) {
        Object.assign(target.leftEye, value.leftEye);
    }
    if (value.rightEye) {
        Object.assign(target.rightEye, value.rightEye);
    }
    if (value.nose) {
        Object.assign(target.nose, value.nose);
    }
    if (value.mouth) {
        Object.assign(target.mouth, value.mouth);
    }
    if (value.global) {
        Object.assign(target.global, value.global);
    }
};
class EyeControl {
    constructor(pose, select, doneValue) {
        this.pose = pose;
        this.select = select;
        this.doneValue = doneValue;
    }
    open(value) {
        for (const eye of this.select(this.pose)) {
            eye.openness = clamp(value, 0, 1);
        }
        return this;
    }
    squint(value) {
        for (const eye of this.select(this.pose)) {
            eye.squint = clamp(value, 0, 1);
        }
        return this;
    }
    tilt(value) {
        for (const eye of this.select(this.pose)) {
            eye.tilt = clamp(value, -1, 1);
        }
        return this;
    }
    pupil(x, y) {
        for (const eye of this.select(this.pose)) {
            eye.pupilX = clamp(x, -1, 1);
            eye.pupilY = clamp(y, -1, 1);
        }
        return this;
    }
    brightness(value) {
        for (const eye of this.select(this.pose)) {
            eye.brightness = clamp(value, 0, 2);
        }
        return this;
    }
    done() {
        return this.doneValue;
    }
}
class MouthControl {
    constructor(pose, doneValue) {
        this.pose = pose;
        this.doneValue = doneValue;
    }
    open(value) {
        this.pose.mouth.openness = clamp(value, 0, 1);
        return this;
    }
    smile(value) {
        this.pose.mouth.curvature = clamp(value, -1, 1);
        return this;
    }
    width(value) {
        this.pose.mouth.width = clamp(value, 0.2, 1.2);
        return this;
    }
    tilt(value) {
        this.pose.mouth.tilt = clamp(value, -1, 1);
        return this;
    }
    brightness(value) {
        this.pose.mouth.brightness = clamp(value, 0, 2);
        return this;
    }
    done() {
        return this.doneValue;
    }
}
class NoseControl {
    constructor(pose, doneValue) {
        this.pose = pose;
        this.doneValue = doneValue;
    }
    scale(value) {
        this.pose.nose.scale = clamp(value, 0.1, 1.5);
        return this;
    }
    tilt(value) {
        this.pose.nose.tilt = clamp(value, -1, 1);
        return this;
    }
    brightness(value) {
        this.pose.nose.brightness = clamp(value, 0, 2);
        return this;
    }
    done() {
        return this.doneValue;
    }
}
class RobotFaceRenderer {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.character = pinuCharacter;
        this.currentPose = createPose();
        this.basePose = createPose();
        this.composedPose = createPose();
        this.actionPose = createPose();
        this.targetEmotionPose = createPose();
        this.fromEmotionPose = createPose();
        this.manualPose = createUnsetPose();
        this.bothEyesControl = new EyeControl(this.manualPose, (pose) => [pose.leftEye, pose.rightEye], this);
        this.leftEyeControl = new EyeControl(this.manualPose, (pose) => [pose.leftEye], this);
        this.rightEyeControl = new EyeControl(this.manualPose, (pose) => [pose.rightEye], this);
        this.mouthControl = new MouthControl(this.manualPose, this);
        this.noseControl = new NoseControl(this.manualPose, this);
        this.cachedConstructionStyle = null;
        this.cachedConstructionWidth = 0;
        this.cachedConstructionHeight = 0;
        this.cachedConstructionAnchors = null;
        this.transparentBackground = false;
        this.running = false;
        this.rafId = 0;
        this.lastTime = 0;
        this.elapsed = 0;
        this.dpr = 1;
        this.logicalWidth = 0;
        this.logicalHeight = 0;
        this.emotionTargetName = "neutral";
        this.activeActionName = null;
        this.actionVisualName = null;
        this.actionBlend = 0;
        this.emotionIntensity = 1;
        this.activeActionPersistent = false;
        this.activeActionUntil = 0;
        this.overlayActionName = null;
        this.overlayActionStartedAt = 0;
        this.overlayActionDurationMs = 0;
        this.emotionFromTime = 0;
        this.emotionDurationMs = EMOTIONS.neutral.durationMs;
        this.emotionEase = EMOTIONS.neutral.ease;
        this.initialEmotionName = "neutral";
        this.initialEmotionIntensity = 1;
        this.initialMode = "face";
        this.initialSymbolName = null;
        this.blinkProgress = 0;
        this.blinkDurationMs = EMOTIONS.neutral.blinkDurationMs;
        this.blinkActive = false;
        this.winkProgress = 0;
        this.winkDurationMs = 220;
        this.winkActive = false;
        this.winkSide = "right";
        this.autoBlinkInMs = 2400;
        this.lookTargetX = 0;
        this.lookTargetY = 0;
        this.lookX = 0;
        this.lookY = 0;
        this.speakingTarget = 0;
        this.speakingAmount = 0;
        this.speakingCadence = 4.5;
        this.speakingUntil = 0;
        this.speakingEnabled = false;
        this.speakingPhase = 0;
        this.tick = (time) => {
            if (!this.running) {
                return;
            }
            const dtMs = this.lastTime === 0 ? 16.67 : Math.min(48, time - this.lastTime);
            this.lastTime = time;
            this.elapsed = time;
            this.update(dtMs / 1000, dtMs);
            this.render();
            this.rafId = requestAnimationFrame(this.tick);
        };
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("Canvas 2D context is required.");
        }
        this.ctx = context;
        this.character =
            options.character !== undefined ? resolveCharacter(options.character) : pinuCharacter;
        this.theme = resolveTheme("cyan");
        this.style = resolveStyle("classic");
        this.features = { ...FACE_FEATURE_DEFAULTS };
        this.parts = { ...PART_STYLE_DEFAULTS };
        this.applyCharacterDefaults(this.character);
        this.mode = "face";
        this.symbolName = null;
        this.backgroundFx = { ...DEFAULT_BACKGROUND_FX };
        if (options.faceTheme) {
            this.applyFaceThemeDefinition(resolveFaceTheme(options.faceTheme), true);
        }
        if (options.theme) {
            this.theme = resolveTheme(options.theme);
        }
        if (options.style) {
            this.style = resolveCharacterStyle(this.character, options.style);
        }
        if (options.features) {
            this.features = mergeFeatures(this.features, options.features);
        }
        if (options.parts) {
            this.parts = mergeParts(this.parts, options.parts);
        }
        if (options.mode) {
            this.mode = options.mode;
        }
        if (options.symbol) {
            this.symbolName = options.symbol;
            this.mode = "symbol";
        }
        if (options.backgroundFx) {
            this.backgroundFx = resolveBackgroundFx(options.backgroundFx);
        }
        this.transparentBackground = options.transparentBackground ?? false;
        this.dpr =
            normalizePixelRatio(options.pixelRatio) ??
                (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
        const neutralDefinition = this.getEmotionDefinition("neutral");
        this.emotionDurationMs = neutralDefinition.durationMs;
        this.emotionEase = neutralDefinition.ease;
        this.blinkDurationMs = neutralDefinition.blinkDurationMs;
        this.autoBlinkInMs = this.randomBlinkDelay(neutralDefinition);
        this.initialEmotionName = this.emotionTargetName;
        this.initialEmotionIntensity = this.emotionIntensity;
        this.initialMode = this.mode;
        this.initialSymbolName = this.symbolName;
        copyPose(this.currentPose, neutralDefinition.pose);
        copyPose(this.basePose, neutralDefinition.pose);
        copyPose(this.targetEmotionPose, neutralDefinition.pose);
        copyPose(this.fromEmotionPose, neutralDefinition.pose);
        if (options.autoStart !== false) {
            this.start();
        }
    }
    emote(name, options = {}) {
        const definition = this.getEmotionDefinition(name);
        this.clearManualOverrides();
        this.emotionTargetName = name;
        this.emotionIntensity = clamp(options.intensity ?? 1, 0, 1);
        this.activeActionName = null;
        this.activeActionPersistent = false;
        this.activeActionUntil = 0;
        this.overlayActionName = null;
        this.clearSpeaking();
        this.applyDisplayState(name, this.emotionIntensity, definition);
        return this;
    }
    runOverlayAction(name, options = {}) {
        this.clearManualOverrides();
        this.clearSpeaking();
        this.overlayActionName = name;
        this.overlayActionStartedAt = this.elapsed;
        const overlayDuration = options.durationMs;
        this.overlayActionDurationMs =
            typeof overlayDuration === "number" && Number.isFinite(overlayDuration) && overlayDuration > 0
                ? overlayDuration
                : DEFAULT_OVERLAY_ACTION_DURATION_MS[name];
        return this;
    }
    think(options = {}) {
        return this.activateAction("thinking", options);
    }
    listen(options = {}) {
        return this.activateAction("listening", options);
    }
    sleep(options = {}) {
        return this.activateAction("sleeping", options);
    }
    goOffline(options = {}) {
        return this.activateAction("offline", options);
    }
    bootUp(options = {}) {
        return this.runOverlayAction("bootUp", options);
    }
    glitch(options = {}) {
        return this.runOverlayAction("glitch", options);
    }
    reset() {
        this.clearManualOverrides();
        this.lookTargetX = 0;
        this.lookTargetY = 0;
        this.lookX = 0;
        this.lookY = 0;
        this.blinkActive = false;
        this.blinkProgress = 0;
        this.winkActive = false;
        this.winkProgress = 0;
        this.clearSpeaking();
        this.activeActionName = null;
        this.actionVisualName = null;
        this.actionBlend = 0;
        this.activeActionPersistent = false;
        this.activeActionUntil = 0;
        this.overlayActionName = null;
        this.mode = this.initialMode;
        this.symbolName = this.initialSymbolName;
        this.emotionTargetName = this.initialEmotionName;
        this.emotionIntensity = this.initialEmotionIntensity;
        this.applyDisplayState(this.emotionTargetName, this.emotionIntensity);
        return this;
    }
    transitionTo(state) {
        assignPartialPose(this.manualPose, state);
        return this;
    }
    lookAt(x, y) {
        this.lookTargetX = clamp(x, -1, 1);
        this.lookTargetY = clamp(y, -1, 1);
        return this;
    }
    lookLeft(amount = 1) {
        return this.lookAt(-clamp(amount, 0, 1), this.lookTargetY);
    }
    lookRight(amount = 1) {
        return this.lookAt(clamp(amount, 0, 1), this.lookTargetY);
    }
    lookUp(amount = 1) {
        return this.lookAt(this.lookTargetX, -clamp(amount, 0, 1));
    }
    lookDown(amount = 1) {
        return this.lookAt(this.lookTargetX, clamp(amount, 0, 1));
    }
    smile(amount = 1, options = {}) {
        assignPartialPose(this.manualPose, { mouth: mouthPreset("smile", amount, options) });
        return this;
    }
    frown(amount = 1, options = {}) {
        assignPartialPose(this.manualPose, { mouth: mouthPreset("frown", amount, options) });
        return this;
    }
    pout(amount = 1, options = {}) {
        assignPartialPose(this.manualPose, { mouth: mouthPreset("pout", amount, options) });
        return this;
    }
    blink() {
        this.blinkActive = true;
        this.blinkProgress = 0;
        return this;
    }
    wink(side = "right") {
        this.winkSide = side;
        this.winkActive = true;
        this.winkProgress = 0;
        return this;
    }
    speak(options = {}) {
        const enabled = options.enabled ?? true;
        const intensity = clamp(options.intensity ?? 0.35, 0, 1);
        this.speakingEnabled = enabled && intensity > 0;
        this.speakingTarget = this.speakingEnabled ? intensity : 0;
        this.speakingCadence = clamp(options.cadence ?? 4.5, 1.5, 9);
        this.speakingUntil = options.durationMs ? this.elapsed + options.durationMs : 0;
        return this;
    }
    setCharacter(character) {
        this.character = resolveCharacter(character);
        this.applyCharacterDefaults(this.character);
        this.syncCharacterEmotionState();
        return this;
    }
    setTheme(theme) {
        this.theme = resolveTheme(theme);
        return this;
    }
    setFaceTheme(faceTheme) {
        this.applyFaceThemeDefinition(resolveFaceTheme(faceTheme), true);
        return this;
    }
    setStyle(style) {
        this.style = resolveCharacterStyle(this.character, style);
        return this;
    }
    setParts(parts) {
        this.parts = mergeParts(this.parts, parts);
        return this;
    }
    setMode(mode) {
        this.mode = mode;
        return this;
    }
    showSymbol(symbol) {
        this.mode = "symbol";
        this.symbolName = symbol;
        return this;
    }
    showFace() {
        this.mode = "face";
        return this;
    }
    setBackgroundFx(config) {
        this.backgroundFx = resolveBackgroundFx(config);
        return this;
    }
    configure(config) {
        let characterChanged = false;
        if (config.character !== undefined) {
            this.character = resolveCharacter(config.character);
            this.applyCharacterDefaults(this.character);
            characterChanged = true;
        }
        if (config.faceTheme) {
            this.applyFaceThemeDefinition(resolveFaceTheme(config.faceTheme), true);
        }
        if (config.theme) {
            this.theme = resolveTheme(config.theme);
        }
        if (config.style) {
            this.style = resolveCharacterStyle(this.character, config.style);
        }
        if (config.features) {
            this.features = mergeFeatures(this.features, config.features);
        }
        if (config.parts) {
            this.parts = mergeParts(this.parts, config.parts);
        }
        if (config.mode) {
            this.mode = config.mode;
        }
        if (config.symbol) {
            this.symbolName = config.symbol;
            this.mode = "symbol";
        }
        if (config.backgroundFx) {
            this.backgroundFx = resolveBackgroundFx(config.backgroundFx);
        }
        if (config.transparentBackground !== undefined) {
            this.transparentBackground = config.transparentBackground;
        }
        const normalizedPixelRatio = normalizePixelRatio(config.pixelRatio);
        if (normalizedPixelRatio !== undefined) {
            this.dpr = normalizedPixelRatio;
        }
        if (characterChanged) {
            this.syncCharacterEmotionState();
        }
        return this;
    }
    start() {
        if (this.running) {
            return this;
        }
        this.running = true;
        this.lastTime = 0;
        this.rafId = requestAnimationFrame(this.tick);
        return this;
    }
    stop() {
        this.running = false;
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = 0;
        }
        return this;
    }
    destroy() {
        this.stop();
    }
    render() {
        this.syncCanvasSize();
        this.drawFrame();
        return this;
    }
    eyes() {
        return this.bothEyesControl;
    }
    leftEye() {
        return this.leftEyeControl;
    }
    rightEye() {
        return this.rightEyeControl;
    }
    mouth() {
        return this.mouthControl;
    }
    nose() {
        return this.noseControl;
    }
    clearManualOverrides() {
        clearPose(this.manualPose);
    }
    clearSpeaking() {
        this.speakingEnabled = false;
        this.speakingUntil = 0;
        this.speakingTarget = 0;
        this.speakingAmount = 0;
        this.speakingPhase = 0;
    }
    activateAction(name, options) {
        this.clearManualOverrides();
        this.clearSpeaking();
        this.activeActionName = name;
        this.actionVisualName = name;
        this.activeActionPersistent = options.persistent ?? false;
        if (this.activeActionPersistent) {
            this.activeActionUntil = 0;
        }
        else {
            const actionDuration = options.durationMs;
            const durationMs = typeof actionDuration === "number" && Number.isFinite(actionDuration) && actionDuration > 0
                ? actionDuration
                : DEFAULT_ACTION_DURATION_MS[name];
            this.activeActionUntil = this.elapsed + durationMs;
        }
        this.overlayActionName = null;
        const definition = this.getActionDefinition(name);
        this.blinkDurationMs = definition.blinkDurationMs;
        this.autoBlinkInMs = this.randomBlinkDelay(definition);
        return this;
    }
    applyCharacterDefaults(character) {
        this.style = character.defaultStyle;
        this.features = mergeFeatures({ ...FACE_FEATURE_DEFAULTS }, character.defaultFeatures);
        this.parts = resolveCharacterParts(character);
    }
    getEmotionDefinition(name) {
        return this.character.emotions?.[name] ?? EMOTIONS[name];
    }
    getActionDefinition(name) {
        return this.character.actions?.[name] ?? ACTION_DEFINITIONS[name];
    }
    applyDisplayState(name, intensity = 1, definition = this.getEmotionDefinition(name)) {
        copyPose(this.fromEmotionPose, this.basePose);
        blendPoseFromNeutral(definition.pose, clamp(intensity, 0, 1), this.targetEmotionPose);
        this.emotionFromTime = this.elapsed;
        this.emotionDurationMs = definition.durationMs;
        this.emotionEase = definition.ease;
        this.blinkDurationMs = definition.blinkDurationMs;
        this.autoBlinkInMs = this.randomBlinkDelay(definition);
    }
    syncCharacterEmotionState() {
        this.actionVisualName = this.activeActionName;
        this.applyDisplayState(this.emotionTargetName, this.emotionIntensity);
    }
    get visualActionName() {
        return this.activeActionName ?? this.actionVisualName;
    }
    get visualDisplayName() {
        return this.visualActionName ?? this.emotionTargetName;
    }
    // biome-ignore lint/correctness/noUnusedPrivateClassMembers: tests inspect this internal runtime state directly.
    get displayName() {
        return this.activeActionName ?? this.emotionTargetName;
    }
    applyFaceThemeDefinition(faceTheme, resetProfile = false) {
        if (resetProfile) {
            this.applyCharacterDefaults(this.character);
            this.mode = "face";
            this.symbolName = null;
            this.backgroundFx = { ...DEFAULT_BACKGROUND_FX };
        }
        if (faceTheme.theme) {
            this.theme = resolveTheme(faceTheme.theme);
        }
        if (faceTheme.style && canApplyLockedCharacterThemeStyle(this.character, faceTheme.style)) {
            this.style = resolveCharacterStyle(this.character, faceTheme.style);
        }
        if (faceTheme.features) {
            this.features = mergeFeatures(this.features, faceTheme.features);
        }
        if (faceTheme.parts) {
            this.parts = mergeParts(this.parts, faceTheme.parts);
        }
        if (faceTheme.mode) {
            this.mode = faceTheme.mode;
        }
        if (faceTheme.symbol) {
            this.symbolName = faceTheme.symbol;
            this.mode = "symbol";
        }
        if (faceTheme.backgroundFx) {
            this.backgroundFx = resolveBackgroundFx(faceTheme.backgroundFx);
        }
    }
    update(dt, dtMs) {
        const animationDefinition = this.activeActionName === null
            ? this.getEmotionDefinition(this.emotionTargetName)
            : this.getActionDefinition(this.activeActionName);
        const emotionProgress = clamp((this.elapsed - this.emotionFromTime) / this.emotionDurationMs, 0, 1);
        lerpPose(this.basePose, this.fromEmotionPose, this.targetEmotionPose, ease(this.emotionEase, emotionProgress));
        if (this.activeActionName &&
            !this.activeActionPersistent &&
            this.activeActionUntil > 0 &&
            this.elapsed >= this.activeActionUntil) {
            this.activeActionName = null;
            this.activeActionUntil = 0;
            this.activeActionPersistent = false;
            this.applyDisplayState(this.emotionTargetName, this.emotionIntensity);
        }
        const actionTargetBlend = this.activeActionName ? 1 : 0;
        const actionBlendName = this.visualActionName;
        const actionBlendSpeed = actionBlendName
            ? actionTargetBlend === 0
                ? 14
                : ACTION_BLEND_SPEED[actionBlendName]
            : 10;
        this.actionBlend = damp(this.actionBlend, actionTargetBlend, dt, actionBlendSpeed);
        if (!this.activeActionName && this.actionVisualName && this.actionBlend <= 0.02) {
            this.actionBlend = 0;
            this.actionVisualName = null;
        }
        this.lookX = damp(this.lookX, this.lookTargetX, dt, 9);
        this.lookY = damp(this.lookY, this.lookTargetY, dt, 9);
        if (this.blinkActive) {
            this.blinkProgress += dtMs / this.blinkDurationMs;
            if (this.blinkProgress >= 1) {
                this.blinkActive = false;
                this.blinkProgress = 0;
                this.autoBlinkInMs = this.randomBlinkDelay(animationDefinition);
            }
        }
        else {
            this.autoBlinkInMs -= dtMs;
            if (this.autoBlinkInMs <= 0) {
                this.blink();
            }
        }
        if (this.winkActive) {
            this.winkProgress += dtMs / this.winkDurationMs;
            if (this.winkProgress >= 1) {
                this.winkActive = false;
                this.winkProgress = 0;
            }
        }
        if (this.speakingUntil && this.elapsed >= this.speakingUntil) {
            this.clearSpeaking();
        }
        this.speakingAmount = damp(this.speakingAmount, this.speakingTarget, dt, 8);
        this.speakingPhase += dt * this.speakingCadence;
        if (this.overlayActionName) {
            const performanceProgress = clamp((this.elapsed - this.overlayActionStartedAt) / this.overlayActionDurationMs, 0, 1);
            if (performanceProgress >= 1) {
                this.overlayActionName = null;
            }
        }
        this.composePose(dt);
    }
    composePose(dt) {
        const emotionDefinition = this.getEmotionDefinition(this.emotionTargetName);
        copyPose(this.composedPose, this.basePose);
        applyOverrides(this.composedPose, this.manualPose);
        const intensity = this.emotionIntensity;
        const bobWave = wave(this.elapsed / 1000, emotionDefinition.microBobHz);
        const swayWave = wave((this.elapsed + 270) / 1000, emotionDefinition.microBobHz * 0.5);
        this.composedPose.global.bob += emotionDefinition.microBob * bobWave * intensity;
        this.composedPose.leftEye.tilt += emotionDefinition.microSway * 0.18 * swayWave * intensity;
        this.composedPose.rightEye.tilt -= emotionDefinition.microSway * 0.18 * swayWave * intensity;
        if (this.emotionTargetName === "confused") {
            const delay = 0.5 + 0.5 * wave(this.elapsed / 1000, 1.1);
            const mouthWobble = wave((this.elapsed + 140) / 1000, 2.2);
            const mouthDrift = wave((this.elapsed + 20) / 1000, 0.8);
            this.composedPose.rightEye.openness -= 0.08 * delay;
            this.composedPose.mouth.tilt += 0.08 * delay + mouthWobble * 0.04;
            this.composedPose.mouth.curvature += mouthWobble * 0.035;
            this.composedPose.mouth.width += mouthDrift * 0.02;
        }
        if (this.actionVisualName && this.actionBlend > 0.001) {
            const actionDefinition = this.getActionDefinition(this.actionVisualName);
            const actionAmount = clamp(this.actionBlend * ACTION_BLEND_STRENGTH[this.actionVisualName], 0, 1);
            lerpPose(this.actionPose, this.composedPose, actionDefinition.pose, actionAmount);
            copyPose(this.composedPose, this.actionPose);
            const actionBobWave = wave(this.elapsed / 1000, actionDefinition.microBobHz);
            const actionSwayWave = wave((this.elapsed + 270) / 1000, actionDefinition.microBobHz * 0.5);
            this.composedPose.global.bob += actionDefinition.microBob * actionBobWave * actionAmount;
            this.composedPose.leftEye.tilt +=
                actionDefinition.microSway * 0.18 * actionSwayWave * actionAmount;
            this.composedPose.rightEye.tilt -=
                actionDefinition.microSway * 0.18 * actionSwayWave * actionAmount;
            if (this.actionVisualName === "offline") {
                const shutdown = ease("smooth", clamp((this.actionBlend - 0.16) / 0.68, 0, 1));
                const cutoffPulse = Math.sin(Math.PI * clamp(this.actionBlend / 0.9, 0, 1));
                this.composedPose.global.flicker += cutoffPulse * 0.08;
                this.composedPose.global.distortion += cutoffPulse * 0.04;
                this.composedPose.global.glow *= 1 - shutdown * 0.18;
                this.composedPose.leftEye.openness = lerp(this.composedPose.leftEye.openness, 0.02, shutdown * 0.55);
                this.composedPose.rightEye.openness = lerp(this.composedPose.rightEye.openness, 0.02, shutdown * 0.55);
                this.composedPose.mouth.brightness *= 1 - shutdown * 0.3;
                this.composedPose.nose.brightness *= 1 - shutdown * 0.25;
            }
        }
        const blinkAmount = this.blinkActive ? Math.sin(Math.PI * this.blinkProgress) : 0;
        if (blinkAmount > 0) {
            this.composedPose.leftEye.openness *= 1 - 0.98 * blinkAmount;
            this.composedPose.rightEye.openness *= 1 - 0.98 * blinkAmount;
            this.composedPose.leftEye.squint = clamp(this.composedPose.leftEye.squint + blinkAmount * 0.5, 0, 1);
            this.composedPose.rightEye.squint = clamp(this.composedPose.rightEye.squint + blinkAmount * 0.5, 0, 1);
        }
        const winkAmount = this.winkActive ? Math.sin(Math.PI * this.winkProgress) : 0;
        if (winkAmount > 0) {
            const winkEye = this.winkSide === "left" ? this.composedPose.leftEye : this.composedPose.rightEye;
            winkEye.openness *= 1 - 0.985 * winkAmount;
            winkEye.squint = clamp(winkEye.squint + winkAmount * 0.55, 0, 1);
        }
        const lookStrength = 0.62;
        this.composedPose.leftEye.pupilX = clamp(this.composedPose.leftEye.pupilX + this.lookX * lookStrength, -1, 1);
        this.composedPose.rightEye.pupilX = clamp(this.composedPose.rightEye.pupilX + this.lookX * lookStrength, -1, 1);
        this.composedPose.leftEye.pupilY = clamp(this.composedPose.leftEye.pupilY + this.lookY * lookStrength, -1, 1);
        this.composedPose.rightEye.pupilY = clamp(this.composedPose.rightEye.pupilY + this.lookY * lookStrength, -1, 1);
        this.composedPose.leftEye.tilt += this.lookX * 0.04;
        this.composedPose.rightEye.tilt += this.lookX * 0.04;
        const talkOverlay = this.speakingAmount > 0.001
            ? (0.25 + 0.75 * Math.abs(Math.sin(this.speakingPhase * Math.PI)) ** 0.8) *
                this.speakingAmount
            : 0;
        if (talkOverlay > 0) {
            this.composedPose.mouth.openness = clamp(this.composedPose.mouth.openness + talkOverlay * 1.08, 0, 1);
            this.composedPose.mouth.width = clamp(this.composedPose.mouth.width + talkOverlay * 0.15, 0.2, 1.2);
            this.composedPose.mouth.curvature = damp(this.composedPose.mouth.curvature, 0.05, dt, 10);
            this.composedPose.mouth.brightness += talkOverlay * 0.3;
            this.composedPose.global.glow += talkOverlay * 0.08;
            this.composedPose.global.flicker += talkOverlay * 0.05;
            this.composedPose.leftEye.openness = clamp(this.composedPose.leftEye.openness - talkOverlay * 0.05, 0, 1);
            this.composedPose.rightEye.openness = clamp(this.composedPose.rightEye.openness - talkOverlay * 0.05, 0, 1);
        }
        if (this.overlayActionName) {
            const performanceProgress = clamp((this.elapsed - this.overlayActionStartedAt) / this.overlayActionDurationMs, 0, 1);
            if (this.overlayActionName === "glitch") {
                const burst = Math.sin(performanceProgress * Math.PI);
                this.composedPose.global.jitter += 0.018 * burst;
                this.composedPose.global.distortion += 0.5 * burst;
                this.composedPose.global.flicker += 0.4 * burst;
                this.composedPose.leftEye.openness = clamp(this.composedPose.leftEye.openness - 0.12 * burst, 0, 1);
                this.composedPose.rightEye.openness = clamp(this.composedPose.rightEye.openness + 0.08 * burst, 0, 1);
                this.composedPose.mouth.tilt += 0.2 * burst * wave(this.elapsed / 1000, 12);
            }
            if (this.overlayActionName === "bootUp") {
                const open = ease("smooth", clamp((performanceProgress - 0.12) / 0.72, 0, 1));
                const brightness = ease("smooth", clamp((performanceProgress - 0.08) / 0.84, 0, 1));
                this.composedPose.leftEye.openness = Math.min(this.composedPose.leftEye.openness, 0.04 + open * 0.96);
                this.composedPose.rightEye.openness = Math.min(this.composedPose.rightEye.openness, 0.04 + open * 0.96);
                this.composedPose.mouth.openness *= brightness;
                this.composedPose.mouth.brightness *= brightness;
                this.composedPose.nose.brightness *= brightness;
                this.composedPose.global.glow *= 0.35 + brightness * 0.9;
                this.composedPose.global.scanline = Math.max(this.composedPose.global.scanline, 0.26);
                this.composedPose.global.flicker += (1 - brightness) * 0.24;
            }
        }
        const current = this.currentPose;
        current.leftEye.openness = damp(current.leftEye.openness, this.composedPose.leftEye.openness, dt, 16);
        current.leftEye.squint = damp(current.leftEye.squint, this.composedPose.leftEye.squint, dt, 14);
        current.leftEye.tilt = damp(current.leftEye.tilt, this.composedPose.leftEye.tilt, dt, 14);
        current.leftEye.pupilX = damp(current.leftEye.pupilX, this.composedPose.leftEye.pupilX, dt, 18);
        current.leftEye.pupilY = damp(current.leftEye.pupilY, this.composedPose.leftEye.pupilY, dt, 18);
        current.leftEye.brightness = damp(current.leftEye.brightness, this.composedPose.leftEye.brightness, dt, 12);
        current.rightEye.openness = damp(current.rightEye.openness, this.composedPose.rightEye.openness, dt, 16);
        current.rightEye.squint = damp(current.rightEye.squint, this.composedPose.rightEye.squint, dt, 14);
        current.rightEye.tilt = damp(current.rightEye.tilt, this.composedPose.rightEye.tilt, dt, 14);
        current.rightEye.pupilX = damp(current.rightEye.pupilX, this.composedPose.rightEye.pupilX, dt, 18);
        current.rightEye.pupilY = damp(current.rightEye.pupilY, this.composedPose.rightEye.pupilY, dt, 18);
        current.rightEye.brightness = damp(current.rightEye.brightness, this.composedPose.rightEye.brightness, dt, 12);
        current.nose.scale = damp(current.nose.scale, this.composedPose.nose.scale, dt, 10);
        current.nose.tilt = damp(current.nose.tilt, this.composedPose.nose.tilt, dt, 10);
        current.nose.brightness = damp(current.nose.brightness, this.composedPose.nose.brightness, dt, 10);
        current.mouth.openness = damp(current.mouth.openness, this.composedPose.mouth.openness, dt, 12);
        current.mouth.curvature = damp(current.mouth.curvature, this.composedPose.mouth.curvature, dt, 12);
        current.mouth.width = damp(current.mouth.width, this.composedPose.mouth.width, dt, 10);
        current.mouth.tilt = damp(current.mouth.tilt, this.composedPose.mouth.tilt, dt, 10);
        current.mouth.brightness = damp(current.mouth.brightness, this.composedPose.mouth.brightness, dt, 10);
        current.global.glow = damp(current.global.glow, this.composedPose.global.glow, dt, 10);
        current.global.bob = damp(current.global.bob, this.composedPose.global.bob, dt, 8);
        current.global.jitter = damp(current.global.jitter, this.composedPose.global.jitter, dt, 18);
        current.global.distortion = damp(current.global.distortion, this.composedPose.global.distortion, dt, 18);
        current.global.flicker = damp(current.global.flicker, this.composedPose.global.flicker, dt, 18);
        current.global.scanline = damp(current.global.scanline, this.composedPose.global.scanline, dt, 12);
    }
    syncCanvasSize() {
        const cssWidth = this.canvas.clientWidth || this.canvas.width || 480;
        const cssHeight = this.canvas.clientHeight || this.canvas.height || 320;
        const dpr = this.dpr;
        const displayWidth = Math.max(1, Math.round(cssWidth * dpr));
        const displayHeight = Math.max(1, Math.round(cssHeight * dpr));
        if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
            this.canvas.width = displayWidth;
            this.canvas.height = displayHeight;
        }
        this.logicalWidth = cssWidth;
        this.logicalHeight = cssHeight;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    drawFrame() {
        const ctx = this.ctx;
        const width = this.logicalWidth;
        const height = this.logicalHeight;
        const pose = this.currentPose;
        const jitterAmount = pose.global.jitter;
        const glitch = pose.global.distortion;
        const flicker = 1 - pose.global.flicker * (0.35 + 0.65 * (0.5 + 0.5 * wave(this.elapsed / 1000, 18.5)));
        const faceOffsetY = pose.global.bob * height;
        const jitterX = jitterAmount * width * wave((this.elapsed + 20) / 1000, 17.3);
        const jitterY = jitterAmount * height * wave((this.elapsed + 60) / 1000, 14.1);
        const style = this.style;
        const panelX = width * style.panelInsetX;
        const panelY = height * style.panelInsetY;
        const panelWidth = width - panelX * 2;
        const panelHeight = height - panelY * 2;
        const panelRadius = Math.min(width, height) * style.panelRadius;
        const innerPadding = Math.min(width, height) * style.panelInnerPadding;
        ctx.clearRect(0, 0, width, height);
        if (!this.transparentBackground) {
            ctx.fillStyle = this.theme.background;
            ctx.fillRect(0, 0, width, height);
        }
        if (this.features.panel) {
            roundedRect(ctx, panelX, panelY, panelWidth, panelHeight, panelRadius);
            ctx.fillStyle = this.theme.panel;
            ctx.fill();
            ctx.lineWidth = Math.max(2, Math.min(width, height) * 0.01);
            ctx.strokeStyle = this.theme.panelEdge;
            ctx.stroke();
        }
        this.drawBackgroundFx(panelX + innerPadding, panelY + innerPadding, panelWidth - innerPadding * 2, panelHeight - innerPadding * 2, Math.max(4, panelRadius - innerPadding), pose.global.glow);
        ctx.save();
        ctx.beginPath();
        if (this.features.panel) {
            roundedRect(ctx, panelX + innerPadding, panelY + innerPadding, panelWidth - innerPadding * 2, panelHeight - innerPadding * 2, Math.max(4, panelRadius - innerPadding));
        }
        else {
            ctx.rect(0, 0, width, height);
        }
        ctx.clip();
        ctx.translate(width * 0.5 + jitterX, height * 0.5 + faceOffsetY + jitterY);
        if (glitch > 0.02) {
            this.drawFacePass(-glitch * width * 0.012, glitch * height * 0.004, 0.12, flicker * 0.8);
            this.drawFacePass(glitch * width * 0.008, -glitch * height * 0.003, 0.2, flicker * 0.65);
        }
        this.drawFacePass(0, 0, 1, flicker);
        this.character.drawOverlay?.(this.buildDrawContext(), width, height, pose);
        this.drawScrambleSlices(width, height, pose, flicker);
        ctx.restore();
        if (this.features.scanlines) {
            this.drawScanlines(panelX, panelY, panelWidth, panelHeight, pose.global.scanline);
        }
    }
    buildDrawContext() {
        return {
            ctx: this.ctx,
            theme: this.theme,
            style: this.style,
            emotionName: this.emotionTargetName,
            actionName: this.visualActionName,
            overlayActionName: this.overlayActionName,
            displayName: this.visualDisplayName,
            elapsed: this.elapsed,
            emotionFromTime: this.emotionFromTime,
            mode: this.mode,
            speakingAmount: this.speakingAmount,
        };
    }
    drawFacePass(offsetX, offsetY, alpha, flicker) {
        const ctx = this.ctx;
        const width = this.logicalWidth;
        const height = this.logicalHeight;
        const pose = this.currentPose;
        const dc = this.buildDrawContext();
        const parts = this.parts;
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.globalAlpha = alpha;
        const style = this.style;
        if (this.cachedConstructionAnchors === null ||
            this.cachedConstructionStyle !== style ||
            this.cachedConstructionWidth !== width ||
            this.cachedConstructionHeight !== height) {
            const frame = createConstructionFrame(width, height);
            const layout = createStyleConstructionLayout(style);
            this.cachedConstructionAnchors = resolveConstructionAnchors(frame, layout);
            this.cachedConstructionStyle = style;
            this.cachedConstructionWidth = width;
            this.cachedConstructionHeight = height;
        }
        const constructionAnchors = this.cachedConstructionAnchors;
        const glow = Math.max(8, Math.min(width, height) * style.glowScale * pose.global.glow);
        const eyeHeightScale = clamp(this.parts.eyeHeightScale, 0.5, 1.8);
        const scaledEyeHeight = height * style.eyeHeight * eyeHeightScale;
        const defaultEyeTopY = height * (style.eyeY - style.eyeHeight * 0.5);
        const defaultBrowY = height * style.browY;
        const browOffsetFromEyeTop = defaultBrowY - defaultEyeTopY;
        const browExtraLift = Math.max(0, eyeHeightScale - 1) * scaledEyeHeight * 0.18;
        const dynamicBrowY = height * style.eyeY - scaledEyeHeight * 0.5 + browOffsetFromEyeTop - browExtraLift;
        const confusedBrowRaise = this.visualDisplayName === "confused" ? height * 0.024 : 0;
        const leftBrowY = dynamicBrowY - confusedBrowRaise;
        const rightBrowY = dynamicBrowY + confusedBrowRaise * 0.22;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = this.theme.foreground;
        ctx.fillStyle = this.theme.foreground;
        ctx.shadowColor = this.theme.glow;
        ctx.shadowBlur = glow;
        ctx.globalAlpha *= flicker;
        if (this.mode === "face") {
            const visibility = this.character.getFaceVisibility?.(dc) ?? 1;
            ctx.globalAlpha *= visibility;
        }
        if (this.mode === "symbol") {
            this.drawSymbol(this.resolveSymbol(), width, height, pose);
            ctx.restore();
            return;
        }
        this.character.drawBackground?.(dc, width, height, pose);
        const eyeBaseY = constructionAnchors.eyeLineY;
        if (this.features.brows) {
            if (this.features.leftEye) {
                this.character.drawBrow(dc, {
                    centerX: constructionAnchors.leftEyeX,
                    centerY: leftBrowY,
                    width: width * style.browWidth,
                    height: height * style.browHeight,
                    pose: pose.leftEye,
                    side: -1,
                    parts,
                });
            }
            if (this.features.rightEye) {
                this.character.drawBrow(dc, {
                    centerX: constructionAnchors.rightEyeX,
                    centerY: rightBrowY,
                    width: width * style.browWidth,
                    height: height * style.browHeight,
                    pose: pose.rightEye,
                    side: 1,
                    parts,
                });
            }
        }
        if (this.features.leftEye) {
            this.character.drawEye(dc, {
                centerX: constructionAnchors.leftEyeX,
                centerY: eyeBaseY,
                width: width * style.eyeWidth,
                height: height * style.eyeHeight,
                pose: pose.leftEye,
                side: -1,
                style,
                features: this.features,
                parts,
            });
        }
        if (this.features.rightEye) {
            this.character.drawEye(dc, {
                centerX: constructionAnchors.rightEyeX,
                centerY: eyeBaseY,
                width: width * style.eyeWidth,
                height: height * style.eyeHeight,
                pose: pose.rightEye,
                side: 1,
                style,
                features: this.features,
                parts,
            });
        }
        if (this.features.nose) {
            this.character.drawNose(dc, {
                centerX: 0,
                centerY: height * style.noseY,
                width: width * style.noseWidth,
                height: height * style.noseHeight,
                pose: pose.nose,
                mouthPose: pose.mouth,
                parts,
            });
        }
        if (this.features.mouth) {
            this.character.drawMouth(dc, {
                centerX: 0,
                centerY: height * style.mouthY,
                width: width * style.mouthWidth,
                height: height * style.mouthHeight,
                pose: pose.mouth,
                parts,
            });
        }
        ctx.restore();
    }
    drawScrambleSlices(width, height, pose, flicker) {
        const scramble = this.character.getScrambleStrength
            ? this.character.getScrambleStrength(this.visualDisplayName, pose.global.distortion)
            : Math.max(this.visualDisplayName === "angry" ? 0.16 : 0, pose.global.distortion * 0.7);
        if (scramble < 0.08 || this.mode === "symbol") {
            return;
        }
        const ctx = this.ctx;
        const isAngry = this.visualDisplayName === "angry";
        const slices = isAngry ? 4 : 6;
        const top = isAngry ? -height * 0.22 : -height * 0.3;
        const bandHeight = isAngry ? height * 0.04 : height * 0.055;
        const gap = isAngry ? height * 0.065 : height * 0.045;
        const angryPulse = 0.7 + 0.3 * wave(this.elapsed / 1000, 2.1);
        for (let index = 0; index < slices; index += 1) {
            const y = top +
                index * (bandHeight + gap) +
                wave((this.elapsed + index * 90) / 1000, isAngry ? 6.4 + index * 0.2 : 4.6 + index * 0.2) *
                    height *
                    (isAngry ? 0.008 : 0.01);
            const offsetX = wave((this.elapsed + index * 140) / 1000, isAngry ? 8.8 - index * 0.35 : 8.5 - index * 0.45) *
                width *
                scramble *
                (isAngry ? 0.16 + index * 0.024 : 0.18 + index * 0.03);
            const offsetY = wave((this.elapsed + index * 110) / 1000, isAngry ? 8.6 : 10.5) *
                height *
                scramble *
                (isAngry ? 0.008 : 0.012);
            const alpha = isAngry ? (0.08 + scramble * 0.16) * angryPulse : 0.1 + scramble * 0.22;
            ctx.save();
            ctx.beginPath();
            ctx.rect(-width * 0.5, y, width, bandHeight);
            ctx.clip();
            this.drawFacePass(offsetX, offsetY, alpha, flicker * 0.88);
            ctx.restore();
            if (!isAngry && index % 2 === 0) {
                ctx.save();
                ctx.globalAlpha = 0.05 + scramble * 0.1;
                ctx.fillStyle = this.theme.panel;
                ctx.fillRect(-width * 0.5, y + bandHeight * 0.42, width, bandHeight * 0.12);
                ctx.restore();
            }
        }
    }
    drawBackgroundFx(x, y, width, height, radius, glow) {
        const fx = this.resolveFrameBackgroundFx();
        if (!fx) {
            return;
        }
        const ctx = this.ctx;
        const pulse = 0.55 + 0.45 * (0.5 + 0.5 * wave(this.elapsed / 1000, fx.pulseHz));
        ctx.save();
        roundedRect(ctx, x, y, width, height, radius);
        ctx.clip();
        ctx.fillStyle = fx.color;
        ctx.globalAlpha = clamp(fx.intensity * pulse * (0.82 + glow * 0.08), 0, 0.42);
        ctx.fillRect(x, y, width, height);
        ctx.restore();
    }
    resolveFrameBackgroundFx() {
        if (this.backgroundFx.mode === "off") {
            return null;
        }
        if (this.backgroundFx.mode === "custom") {
            return this.backgroundFx;
        }
        const performanceFx = this.overlayActionName
            ? OVERLAY_ACTION_BACKGROUND_FX[this.overlayActionName]
            : undefined;
        if (performanceFx) {
            return {
                ...DEFAULT_BACKGROUND_FX,
                ...performanceFx,
                mode: "emotion",
            };
        }
        const visualDisplayName = this.visualDisplayName;
        const stateFx = visualDisplayName in EMOTIONS
            ? EMOTION_BACKGROUND_FX[visualDisplayName]
            : ACTION_BACKGROUND_FX[visualDisplayName];
        if (!stateFx) {
            return null;
        }
        return {
            ...DEFAULT_BACKGROUND_FX,
            ...stateFx,
            mode: "emotion",
        };
    }
    resolveSymbol() {
        if (this.symbolName) {
            return this.symbolName;
        }
        if (this.overlayActionName) {
            return OVERLAY_ACTION_SYMBOLS[this.overlayActionName] ?? "ellipsis";
        }
        const visualDisplayName = this.visualDisplayName;
        if (visualDisplayName in EMOTIONS) {
            return EMOTION_SYMBOLS[visualDisplayName] ?? "ellipsis";
        }
        return ACTION_SYMBOLS[visualDisplayName] ?? "ellipsis";
    }
    drawSymbol(symbol, width, height, pose) {
        const ctx = this.ctx;
        const scale = Math.min(width, height);
        const y = -height * 0.02 + pose.global.bob * height * 0.12;
        const brightness = clamp(pose.global.glow, 0.6, 1.6);
        ctx.globalAlpha *= brightness;
        if (symbol === "loading") {
            const active = Math.floor((this.elapsed / 180) % 3);
            for (let index = 0; index < 3; index += 1) {
                ctx.save();
                ctx.globalAlpha *= index === active ? 1 : 0.28;
                drawPixelGlyph(ctx, PIXEL_LOADING_BAR, (index - 1) * scale * 0.13, y + scale * 0.02, scale * 0.09);
                ctx.restore();
            }
            return;
        }
        drawPixelGlyph(ctx, PIXEL_SYMBOL_PATTERNS[symbol] ?? PIXEL_SYMBOL_PATTERNS.warning, 0, y, scale * 0.3);
    }
    drawScanlines(x, y, width, height, strength) {
        if (strength <= 0.01) {
            return;
        }
        const ctx = this.ctx;
        ctx.save();
        ctx.beginPath();
        roundedRect(ctx, x + 6, y + 6, width - 12, height - 12, Math.min(width, height) * 0.06);
        ctx.clip();
        ctx.strokeStyle = this.theme.ghost;
        const thickness = clamp(this.parts.scanlineThickness, 1.25, 6);
        ctx.lineWidth = thickness;
        ctx.globalAlpha = clamp(strength * (0.9 + thickness * 0.12), 0, 0.48);
        const step = clamp(this.parts.scanlineSpacing, 3, 18);
        for (let lineY = y; lineY < y + height; lineY += step) {
            const waveOffset = Math.sin((lineY + this.elapsed * 0.08) * 0.04) * strength * 6;
            ctx.beginPath();
            ctx.moveTo(x + waveOffset, lineY);
            ctx.lineTo(x + width + waveOffset, lineY);
            ctx.stroke();
        }
        ctx.restore();
    }
    randomBlinkDelay(definition) {
        const range = definition.blinkMaxMs - definition.blinkMinMs;
        return definition.blinkMinMs + range * (0.5 + 0.5 * Math.sin(this.elapsed * 0.0017 + 1.234));
    }
}
export const createRobotFace = (canvas, options) => new RobotFaceRenderer(canvas, options);
