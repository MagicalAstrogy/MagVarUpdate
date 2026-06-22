import {
    generateExtraModel,
    invokeExtraModelWithStrategy,
} from '@/function/update/invoke_extra_model';
import { useDataStore } from '@/store';

describe('extra model max chat history', () => {
    beforeEach(() => {
        (globalThis as any).SillyTavern.extensionSettings = {};
        (globalThis as any).SillyTavern.getChatCompletionModel = jest
            .fn()
            .mockReturnValue('claude-test');
        (globalThis as any).generateRaw = jest
            .fn()
            .mockResolvedValue("<UpdateVariable>\n_.set('x', 1);\n</UpdateVariable>");
    });

    afterEach(() => {
        delete (globalThis as any).generateRaw;
        delete (globalThis as any).SillyTavern.getChatCompletionModel;
    });

    test('passes configured max_chat_history to extra model generation', async () => {
        const store = useDataStore();
        store.settings.额外模型解析配置.max_chat_history = 42;

        await generateExtraModel();

        expect((globalThis as any).generateRaw).toHaveBeenCalledWith(
            expect.objectContaining({
                max_chat_history: 42,
            })
        );
    });

    test('adds random header for built-in jailbreak by default', async () => {
        await generateExtraModel();

        const config = (globalThis as any).generateRaw.mock.calls[0][0];
        expect(config.ordered_prompts[0]).toEqual({
            role: 'system',
            content: expect.stringMatching(/^[0-9a-f]{8}\n[0-9a-f]{8}\n[0-9a-f]{8}\n[0-9a-f]{8}$/i),
        });
    });

    test('omits random header when disabled', async () => {
        const store = useDataStore();
        store.settings.额外模型解析配置.随机头部 = false;

        await generateExtraModel();

        const config = (globalThis as any).generateRaw.mock.calls[0][0];
        expect(config.ordered_prompts[0]).not.toEqual(
            expect.objectContaining({
                content: expect.stringMatching(
                    /^[0-9a-f]{8}\n[0-9a-f]{8}\n[0-9a-f]{8}\n[0-9a-f]{8}$/i
                ),
            })
        );
    });

    test('uses temporary saved custom json_object response format for v4 compatible formatted output', async () => {
        const store = useDataStore();
        store.versions.tavernhelper = '4.3.9';
        store.settings.额外模型解析配置.应答格式 = '格式化输出(v4兼容)';
        store.settings.额外模型解析配置.模型来源 = '自定义';
        store.settings.额外模型解析配置.api地址 = 'https://example.com/v1';
        store.settings.额外模型解析配置.模型名称 = 'deepseek-chat';
        store.settings.额外模型解析配置.关闭thinking = true;
        (globalThis as any).SillyTavern.chatCompletionSettings.custom_include_body =
            'existing_flag: true';

        (globalThis as any).generateRaw = jest.fn().mockImplementation(async config => {
            expect((globalThis as any).builtin.saveSettings).toHaveBeenCalledTimes(1);
            expect(
                (globalThis as any).SillyTavern.chatCompletionSettings.custom_include_body
            ).toContain(`response_format:\n  type: json_object`);
            expect(
                (globalThis as any).SillyTavern.chatCompletionSettings.custom_include_body
            ).toContain(`thinking:\n  type: disabled`);
            expect(config.custom_api).toEqual(
                expect.objectContaining({
                    source: 'custom',
                    apiurl: 'https://example.com/v1',
                    model: 'deepseek-chat',
                })
            );
            expect(config.json_schema).toBeUndefined();
            return JSON.stringify({
                analysis: 'ok',
                json_patch: [{ op: 'replace', path: '/x', value: 1 }],
            });
        });

        const result = await generateExtraModel();

        expect(result).toContain('<JSONPatch>');
        expect(result).toContain('"op": "replace"');
        expect((globalThis as any).SillyTavern.chatCompletionSettings.custom_include_body).toBe(
            'existing_flag: true'
        );
        expect((globalThis as any).builtin.saveSettings).toHaveBeenCalledTimes(2);
    });

    test('restores saved custom json_object response format after v4 compatible request failure', async () => {
        const store = useDataStore();
        store.versions.tavernhelper = '4.3.9';
        store.settings.额外模型解析配置.应答格式 = '格式化输出(v4兼容)';
        store.settings.额外模型解析配置.模型来源 = '自定义';
        (globalThis as any).SillyTavern.chatCompletionSettings.custom_include_body =
            'existing_flag: true';
        (globalThis as any).generateRaw = jest.fn().mockRejectedValue(new Error('request failed'));

        await expect(generateExtraModel()).rejects.toThrow('request failed');

        expect((globalThis as any).SillyTavern.chatCompletionSettings.custom_include_body).toBe(
            'existing_flag: true'
        );
        expect((globalThis as any).builtin.saveSettings).toHaveBeenCalledTimes(2);
    });

    test('keeps temporary custom json_object response format for concurrent strategy requests', async () => {
        const store = useDataStore();
        store.versions.tavernhelper = '4.3.9';
        store.settings.额外模型解析配置.应答格式 = '格式化输出(v4兼容)';
        store.settings.额外模型解析配置.模型来源 = '自定义';
        store.settings.额外模型解析配置.请求方式 = '同时请求多次';
        store.settings.额外模型解析配置.请求次数 = 2;
        store.settings.通知.额外模型解析中 = false;
        (globalThis as any).SillyTavern.chatCompletionSettings.custom_include_body =
            'existing_flag: true';

        (globalThis as any).generateRaw = jest.fn().mockImplementation(async config => {
            expect((globalThis as any).builtin.saveSettings).toHaveBeenCalledTimes(1);
            expect(
                (globalThis as any).SillyTavern.chatCompletionSettings.custom_include_body
            ).toContain(`response_format:\n  type: json_object`);
            expect(config.custom_api).toEqual(
                expect.objectContaining({
                    source: 'custom',
                })
            );
            return JSON.stringify({
                analysis: 'ok',
                json_patch: [{ op: 'replace', path: '/x', value: 1 }],
            });
        });

        const result = await invokeExtraModelWithStrategy();

        expect(result).toContain('<JSONPatch>');
        expect((globalThis as any).generateRaw).toHaveBeenCalledTimes(2);
        expect((globalThis as any).SillyTavern.chatCompletionSettings.custom_include_body).toBe(
            'existing_flag: true'
        );
        expect((globalThis as any).builtin.saveSettings).toHaveBeenCalledTimes(2);
    });

    test('blocks reentry while temporary settings save is pending', async () => {
        const store = useDataStore();
        store.versions.tavernhelper = '4.3.9';
        store.settings.额外模型解析配置.应答格式 = '格式化输出(v4兼容)';
        store.settings.额外模型解析配置.模型来源 = '自定义';

        let resolve_save_settings!: () => void;
        let save_settings_calls = 0;
        (globalThis as any).builtin.saveSettings = jest.fn(() => {
            save_settings_calls++;
            if (save_settings_calls === 1) {
                return new Promise<void>(resolve => {
                    resolve_save_settings = resolve;
                });
            }
            return Promise.resolve();
        });

        const first_request = generateExtraModel();
        await Promise.resolve();

        await expect(generateExtraModel()).rejects.toThrow(
            'setExtraAnalysisStates() should not be called recursively.'
        );

        resolve_save_settings();
        (globalThis as any).generateRaw = jest.fn().mockResolvedValue(
            JSON.stringify({
                analysis: 'ok',
                json_patch: [{ op: 'replace', path: '/x', value: 1 }],
            })
        );
        await first_request;
        expect((globalThis as any).SillyTavern.chatCompletionSettings.custom_include_body).toBe(
            undefined
        );
    });

    test('rejects v4 compatible formatted output when model source matches the extension', async () => {
        const store = useDataStore();
        store.settings.额外模型解析配置.应答格式 = '格式化输出(v4兼容)';
        store.settings.额外模型解析配置.模型来源 = '与插头相同';

        await expect(generateExtraModel()).rejects.toThrow('不能与插头相同');

        expect((globalThis as any).generateRaw).not.toHaveBeenCalled();
        expect((globalThis as any).builtin.saveSettings).not.toHaveBeenCalled();
    });

    test('keeps json_schema for regular formatted output without temporary settings save', async () => {
        const store = useDataStore();
        store.settings.额外模型解析配置.应答格式 = '格式化输出';
        (globalThis as any).generateRaw = jest.fn().mockResolvedValue(
            JSON.stringify({
                analysis: 'ok',
                json_patch: [{ op: 'replace', path: '/x', value: 1 }],
            })
        );

        await generateExtraModel();

        expect((globalThis as any).generateRaw).toHaveBeenCalledWith(
            expect.objectContaining({
                json_schema: expect.objectContaining({
                    name: 'mvu_json_patch',
                }),
            })
        );
        expect((globalThis as any).builtin.saveSettings).not.toHaveBeenCalled();
    });
});
