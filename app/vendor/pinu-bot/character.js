const registry = new Map();
export function registerCharacter(character) {
    registry.set(character.name, character);
}
export function getCharacter(name) {
    return registry.get(name);
}
