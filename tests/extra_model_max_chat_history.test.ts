import { generateExtraModel } from '@/function/update/invoke_extra_model';
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
});
