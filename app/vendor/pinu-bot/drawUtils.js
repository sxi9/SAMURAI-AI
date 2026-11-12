const TAU = Math.PI * 2;
export const clamp = (value, min, max) => value < min ? min : value > max ? max : value;
export const wave = (time, frequency) => Math.sin(time * TAU * frequency);
export const roundedRect = (ctx, x, y, width, height, radius) => {
    const safeWidth = Math.max(0, width);
    const safeHeight = Math.max(0, height);
    const r = Math.max(0, Math.min(radius, safeWidth * 0.5, safeHeight * 0.5));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + safeWidth, y, x + safeWidth, y + safeHeight, r);
    ctx.arcTo(x + safeWidth, y + safeHeight, x, y + safeHeight, r);
    ctx.arcTo(x, y + safeHeight, x, y, r);
    ctx.arcTo(x, y, x + safeWidth, y, r);
    ctx.closePath();
};
export const drawPixelGlyph = (ctx, pattern, centerX, centerY, size) => {
    const firstRow = pattern[0] ?? "00000000";
    const columns = firstRow.length || 8;
    const rows = pattern.length || 8;
    const cell = size / columns;
    const originX = centerX - columns * cell * 0.5;
    const originY = centerY - rows * cell * 0.5;
    for (let row = 0; row < rows; row += 1) {
        const line = pattern[row] ?? "";
        for (let col = 0; col < columns; col += 1) {
            if (line[col] !== "1") {
                continue;
            }
            ctx.fillRect(originX + col * cell, originY + row * cell, cell, cell);
        }
    }
};
export const HEART_PATTERN = [
    "01100110",
    "11111111",
    "11111111",
    "11111111",
    "01111110",
    "00111100",
    "00011000",
    "00000000",
];
export const ease = (name, t) => {
    if (name === "snap") {
        return 1 - (1 - t) ** 3;
    }
    if (name === "gentle") {
        return t * t * (3 - 2 * t);
    }
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};
