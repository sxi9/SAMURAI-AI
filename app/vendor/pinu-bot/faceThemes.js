import { STYLE_PRESETS } from "./styles.js";
import { THEMES } from "./themes.js";
const sharpFaceTheme = {
    theme: THEMES.sunset,
    style: STYLE_PRESETS.soft,
    features: {
        pupils: true,
    },
    parts: {
        eyeShape: "sharp",
        browShape: "angled",
        eyeWidthScale: 0.72,
        eyeHeightScale: 0.88,
        mouthShape: "soft",
        scanlineThickness: 1.8,
        scanlineSpacing: 5,
    },
    backgroundFx: {
        mode: "custom",
        color: "#ffb34d",
        intensity: 0.16,
        pulseHz: 1,
    },
};
const sleepyFaceTheme = {
    theme: THEMES.amber,
    style: STYLE_PRESETS.minimal,
    features: {
        pupils: true,
    },
    parts: {
        eyeShape: "sleepy",
        browShape: "soft",
        eyeWidthScale: 0.82,
        eyeHeightScale: 1.08,
        mouthShape: "soft",
        scanlineThickness: 2,
        scanlineSpacing: 4,
    },
    backgroundFx: {
        mode: "custom",
        color: "#ffbf6a",
        intensity: 0.15,
        pulseHz: 0.7,
    },
};
const dropletFaceTheme = {
    theme: THEMES["ice-blue"],
    style: STYLE_PRESETS.soft,
    features: {
        pupils: true,
    },
    parts: {
        eyeShape: "droplet",
        browShape: "bold",
        eyeWidthScale: 0.7,
        eyeHeightScale: 1.2,
        noseShape: "button",
        mouthShape: "soft",
        scanlineThickness: 1.9,
        scanlineSpacing: 5,
    },
    backgroundFx: {
        mode: "custom",
        color: "#72d7ff",
        intensity: 0.14,
        pulseHz: 0.55,
    },
};
export const FACE_THEMES = {
    default: {
        theme: THEMES.cyan,
        parts: {
            scanlineThickness: 5,
            scanlineSpacing: 12,
        },
        backgroundFx: "off",
    },
    companion: {
        theme: THEMES.amber,
        style: STYLE_PRESETS.soft,
        parts: {
            eyeShape: "wide",
            mouthShape: "soft",
            browShape: "soft",
            scanlineThickness: 1.8,
            scanlineSpacing: 5,
        },
        backgroundFx: "emotion",
    },
    service: {
        theme: THEMES["green-crt"],
        style: STYLE_PRESETS.minimal,
        parts: {
            eyeShape: "block",
            mouthShape: "band",
            browShape: "soft",
            scanlineThickness: 2.2,
            scanlineSpacing: 4,
        },
        backgroundFx: "off",
    },
    sentinel: {
        theme: THEMES["red-alert"],
        style: STYLE_PRESETS.industrial,
        parts: {
            eyeShape: "wide",
            mouthShape: "band",
            browShape: "angled",
            noseShape: "bridge",
            eyeWidthScale: 1.08,
            eyeHeightScale: 0.82,
            scanlineThickness: 2,
            scanlineSpacing: 4,
        },
        backgroundFx: "emotion",
    },
    "soft-smile": {
        theme: THEMES.sunset,
        style: STYLE_PRESETS.soft,
        features: {
            brows: false,
        },
        parts: {
            eyeShape: "wide",
            mouthShape: "soft",
            scanlineThickness: 1.6,
            scanlineSpacing: 5,
        },
        backgroundFx: {
            mode: "custom",
            color: "#ffbe72",
            intensity: 0.14,
            pulseHz: 0.7,
        },
    },
    "status-strip": {
        theme: THEMES["green-crt"],
        style: STYLE_PRESETS.minimal,
        features: {
            brows: false,
        },
        parts: {
            eyeShape: "wide",
            eyeWidthScale: 0.72,
            eyeHeightScale: 0.82,
            mouthShape: "band",
            scanlineThickness: 2.4,
            scanlineSpacing: 4,
        },
        backgroundFx: "off",
    },
    "sharp-cheer": sharpFaceTheme,
    "sleepy-muse": sleepyFaceTheme,
    "droplet-dream": dropletFaceTheme,
    sharp: sharpFaceTheme,
    sleepy: sleepyFaceTheme,
    droplet: dropletFaceTheme,
    "caret-cheer": sharpFaceTheme,
    "crescent-muse": sleepyFaceTheme,
    "teardrop-dream": dropletFaceTheme,
};
