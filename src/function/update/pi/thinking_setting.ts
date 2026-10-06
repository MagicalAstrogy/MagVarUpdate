/** 默认值沿用原始协议行为；显式等级由 Pi 按模型能力映射。 */
export const PI_THINKING_LEVELS = [
    'default',
    'off',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
] as const;
export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

export function normalizePiThinkingLevel(value: unknown): PiThinkingLevel {
    return PI_THINKING_LEVELS.includes(value as PiThinkingLevel)
        ? (value as PiThinkingLevel)
        : 'default';
}

export function isPiThinkingEnabled(value: unknown): boolean {
    const level = normalizePiThinkingLevel(value);
    return level !== 'default' && level !== 'off';
}
