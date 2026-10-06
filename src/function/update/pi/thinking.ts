import { clampThinkingLevel, type Api, type Model } from './pi_gateway';
import { normalizePiThinkingLevel, type PiThinkingLevel } from './thinking_setting';

/** 按可信目录或协议适配元数据解析生效等级；缺少元数据时保留显式选择。 */
export function resolvePiThinkingLevel(value: unknown, model?: Model<Api>): PiThinkingLevel {
    const level = normalizePiThinkingLevel(value);
    if (level === 'default' || level === 'off' || !model) return level;
    return model.reasoning ? clampThinkingLevel(model, level) : 'off';
}

/** 为动态模型补充显式启用信息，避免 SDK 再次把支持 effort 的协议降为 high。 */
export function preparePiThinkingModel(
    model: Model<Api>,
    catalogHit: boolean,
    level: PiThinkingLevel
): Model<Api> {
    if (catalogHit || level === 'default') return model;
    const extendedEffort =
        (level === 'xhigh' || level === 'max') &&
        [
            'openai-completions',
            'openai-responses',
            'openai-codex-responses',
            'mistral-conversations',
        ].includes(model.api);
    return {
        ...model,
        reasoning: true,
        ...(extendedEffort ? { thinkingLevelMap: { xhigh: 'xhigh', max: 'max' } } : {}),
    };
}
