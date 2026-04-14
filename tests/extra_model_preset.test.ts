import {
    buildOtherPresetGenerateConfig,
    getAvailableExtraModelPresetNames,
    getExtraModelPreset,
} from '@/function/update/extra_model_preset';

describe('extra_model_preset', () => {
    test('filters available preset names without in_use', () => {
        const globals = globalThis as typeof globalThis & {
            getPresetNames?: () => string[];
        };
        const previous = globals.getPresetNames;
        globals.getPresetNames = () => ['in_use', '分析预设', '', '备用预设'];

        expect(getAvailableExtraModelPresetNames()).toEqual(['分析预设', '备用预设']);

        globals.getPresetNames = previous;
    });

    test('builds ordered prompts, injects and request overrides from target preset', () => {
        const result = buildOtherPresetGenerateConfig(
            {
                settings: {
                    max_completion_tokens: 512,
                    temperature: 0.7,
                    frequency_penalty: 0.2,
                    presence_penalty: -0.1,
                    repetition_penalty: 1.05,
                    top_p: 0.8,
                    min_p: 0.05,
                    top_k: 20,
                    top_a: 0.1,
                },
                prompts: [
                    {
                        id: 'main',
                        enabled: true,
                        role: 'system',
                        content: 'MAIN',
                    },
                    {
                        id: 'worldInfoBefore',
                        enabled: true,
                        position: { type: 'relative' },
                        role: 'system',
                    },
                    {
                        id: 'custom_relative',
                        enabled: true,
                        position: { type: 'relative' },
                        role: 'user',
                        content: 'RELATIVE',
                    },
                    {
                        id: 'custom_depth_b',
                        enabled: true,
                        position: { type: 'in_chat', depth: 3, order: 20 },
                        role: 'system',
                        content: 'B',
                    },
                    {
                        id: 'custom_depth_a',
                        enabled: true,
                        position: { type: 'in_chat', depth: 3, order: 10 },
                        role: 'system',
                        content: 'A',
                    },
                    {
                        id: 'chatHistory',
                        enabled: true,
                        position: { type: 'relative' },
                        role: 'system',
                    },
                ],
            },
            'TASK'
        );

        expect(result.ordered_prompts).toEqual([
            { role: 'system', content: 'MAIN' },
            'world_info_before',
            { role: 'user', content: 'RELATIVE' },
            'chat_history',
        ]);
        expect(result.injects).toEqual([
            {
                position: 'in_chat',
                depth: 0,
                should_scan: false,
                role: 'system',
                content: 'TASK',
            },
            {
                position: 'in_chat',
                depth: 2,
                should_scan: false,
                role: 'system',
                content: '<past_observe>',
            },
            {
                position: 'in_chat',
                depth: 1,
                should_scan: false,
                role: 'system',
                content: '</past_observe>',
            },
            {
                position: 'in_chat',
                depth: 3,
                should_scan: false,
                role: 'system',
                content: 'A\nB',
            },
        ]);
        expect(result.request_overrides).toEqual({
            max_tokens: 512,
            max_completion_tokens: 512,
            temperature: 0.7,
            frequency_penalty: 0.2,
            presence_penalty: -0.1,
            repetition_penalty: 1.05,
            top_p: 0.8,
            min_p: 0.05,
            top_k: 20,
            top_a: 0.1,
        });
    });

    test('throws when getPreset is unavailable', () => {
        const globals = globalThis as typeof globalThis & {
            getPreset?: (name: string) => unknown;
        };
        const previous = globals.getPreset;
        delete globals.getPreset;

        expect(() => getExtraModelPreset('分析预设')).toThrow('当前环境未提供 getPreset 接口');

        globals.getPreset = previous;
    });
});
