/** 验证自动请求条件在消息入口阻止调用，手动重试与随 AI 输出解析保持原行为。 */
import { isExtraModelSupported } from '@/function/is_extra_model_supported';
import { invokeExtraModelWithStrategy } from '@/function/update/invoke_extra_model';
import { onMessageReceived } from '@/function/update/on_message_received';
import { handleVariablesInMessage } from '@/function/update_variables';
import { useDataStore } from '@/store';

jest.mock('@/function/is_extra_model_supported', () => ({
    isExtraModelSupported: jest.fn(),
}));
jest.mock('@/function/update/invoke_extra_model', () => ({
    invokeExtraModelWithStrategy: jest.fn(),
}));
jest.mock('@/function/update_variables', () => ({
    handleVariablesInMessage: jest.fn(),
}));

const mockInvoke = jest.mocked(invokeExtraModelWithStrategy);
const mockHandleVariables = jest.mocked(handleVariablesInMessage);

describe('自动请求条件', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Object.assign(SillyTavern, {
            extensionSettings: {},
            name2: 'Assistant',
            chat: [{}, {}],
            getCurrentChatId: jest.fn().mockReturnValue('conditions-chat'),
        });
        jest.mocked(getChatMessages).mockReturnValue([
            { name: 'Assistant', message: '这是一条完整回复</content>' } as ChatMessage,
        ]);
        jest.mocked(isExtraModelSupported).mockResolvedValue(true);
        mockInvoke.mockResolvedValue('<UpdateVariable>_.set("health", 80);</UpdateVariable>');
        mockHandleVariables.mockResolvedValue(undefined);

        const store = useDataStore();
        store.settings.更新方式 = '额外模型解析';
        store.settings.兼容性.额外模型解析非阻塞 = false;
        Object.assign(store.settings.额外模型解析配置, {
            启用自动请求: true,
            模型来源: '自定义',
            应答格式: '聊天消息',
        });
    });

    test.each([
        ['默认条件', '这是一条普通回复', 0, '', true],
        ['低于最小字数', '这是一条普通回复', 9, '', false],
        ['恰好达到最小字数', '这是一条普通回复', 8, '', true],
        ['超过最小字数', '这是一条普通回复', 7, '', true],
        ['忽略首尾空白', '  这是一条普通回复\n', 9, '', false],
        ['Unicode 字符不重复计数', '正文加上😀', 6, '', false],
        ['Unicode 字符达到边界', '正文加上😀', 5, '', true],
        ['缺少标签', '这是一条普通回复', 0, '</content>', false],
        ['包含标签', '这是一条普通回复</content>', 0, '</content>', true],
        ['支持正则通配', '这是一条普通回复</content>', 0, '</.*>', true],
        ['支持多个标签', '这是一条普通回复</正文>', 0, '</(content|正文)>', true],
        ['正则未匹配', '这是一条普通回复</other>', 0, '</(content|正文)>', false],
        ['支持忽略大小写标志', '这是一条普通回复</CONTENT>', 0, '/<\\/content>/i', true],
        ['支持多行匹配标志', '这是一条普通回复\n</content>', 0, '/^<\\/content>$/m', true],
        ['支持转义特殊字符', '这是一条普通回复[end]', 0, '\\[end\\]$', true],
        ['无效正则', '这是一条普通回复', 0, '[', false],
        ['无效正则标志', '这是一条普通回复', 0, '/content/invalid', false],
        ['缺少正则结束分隔符', '这是一条普通回复', 0, '/content', false],
        ['标签区分大小写', '这是一条普通回复</CONTENT>', 0, '</content>', false],
        ['忽略标签设置首尾空白', '这是一条普通回复</content>', 0, ' </content>\n', true],
        ['空白标签不限制', '这是一条普通回复', 0, ' \n ', true],
        ['仅字数满足', '这是一条普通回复', 8, '</content>', false],
        ['仅标签满足', '这是一条普通回复</content>', 500, '</content>', false],
        ['两个条件均满足', '这是一条普通回复</content>', 8, '</content>', true],
    ])('%s', async (_name, message, min_length, trigger_tag, should_request) => {
        Object.assign(useDataStore().settings.额外模型解析配置, {
            最小请求字数: min_length,
            触发标签: trigger_tag,
        });
        jest.mocked(getChatMessages).mockReturnValue([
            { name: 'Assistant', message } as ChatMessage,
        ]);

        await onMessageReceived(1);

        expect(mockInvoke).toHaveBeenCalledTimes(should_request ? 1 : 0);
        expect(setChatMessages).toHaveBeenCalledTimes(should_request ? 1 : 0);
        expect(mockHandleVariables).toHaveBeenCalledTimes(should_request ? 1 : 0);
        expect(eventOn).not.toHaveBeenCalledWith(
            tavern_events.CHARACTER_MESSAGE_RENDERED,
            expect.any(Function)
        );
    });

    test('关闭自动请求时即使满足条件也不会请求', async () => {
        useDataStore().settings.额外模型解析配置.启用自动请求 = false;

        await onMessageReceived(1);

        expect(mockInvoke).not.toHaveBeenCalled();
    });

    test('带全局标志的正则在多次请求间不保留匹配位置', async () => {
        useDataStore().settings.额外模型解析配置.触发标签 = '/<\\/content>/g';

        await onMessageReceived(1);
        await onMessageReceived(1);

        expect(mockInvoke).toHaveBeenCalledTimes(2);
    });

    test('手动重试绕过无效正则', async () => {
        useDataStore().settings.额外模型解析配置.触发标签 = '[';

        await onMessageReceived(1, { force: true });

        expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    test.each([true, false])('手动重试绕过条件（自动请求开关：%s）', async enabled => {
        Object.assign(useDataStore().settings.额外模型解析配置, {
            启用自动请求: enabled,
            最小请求字数: 500,
            触发标签: '</missing>',
        });

        await onMessageReceived(1, { force: true });

        expect(mockInvoke).toHaveBeenCalledTimes(1);
        expect(mockHandleVariables).toHaveBeenCalledWith(1);
    });

    test('随 AI 输出模式仍解析回复中的变量', async () => {
        const store = useDataStore();
        store.settings.更新方式 = '随AI输出';
        store.settings.额外模型解析配置.最小请求字数 = 500;
        store.settings.额外模型解析配置.触发标签 = '</missing>';

        await onMessageReceived(1);

        expect(mockInvoke).not.toHaveBeenCalled();
        expect(mockHandleVariables).toHaveBeenCalledWith(1);
    });

    test('非阻塞模式跳过时不注册渲染监听', async () => {
        const store = useDataStore();
        store.settings.兼容性.额外模型解析非阻塞 = true;
        store.settings.额外模型解析配置.最小请求字数 = 500;

        await onMessageReceived(1);

        expect(mockInvoke).not.toHaveBeenCalled();
        expect(eventOn).not.toHaveBeenCalledWith(
            tavern_events.CHARACTER_MESSAGE_RENDERED,
            expect.any(Function)
        );
        expect(setChatMessages).not.toHaveBeenCalled();
    });
});
