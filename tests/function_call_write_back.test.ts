import { registerFunction } from '@/function/function_call';
import { useDataStore } from '@/store';
import _ from 'lodash';

// The MVU function tool awaits updateVariables() and replaceVariables() before it appends its
// <UpdateVariable> block. setChatMessages replaces the whole text, so the block must be appended to the
// message as it is at write time; an edit another extension made during those awaits must survive.
describe('MVU function tool write-back', () => {
    test('工具调用追加变量块时应基于最新消息，不覆盖其他扩展的修改', async () => {
        (globalThis as any)._ = _;
        (globalThis as any).YAML = { parse: JSON.parse };
        useDataStore().settings.兼容性.更新到聊天变量 = false;

        const message = '模型回复正文';
        const edited = '模型回复正文\n\n<img src="another-extension.png">';
        const state = { current: message };
        (globalThis as any).getLastMessageId = jest.fn().mockReturnValue(0);
        (globalThis as any).getChatMessages = jest.fn(() => [
            { message: state.current, role: 'assistant' },
        ]);
        (globalThis as any).SillyTavern = {
            ...(globalThis as any).SillyTavern,
            chat: [
                {
                    swipe_id: 0,
                    variables: [
                        {
                            stat_data: { health: 100 },
                            display_data: {},
                            delta_data: {},
                            schema: { type: 'object', properties: {} },
                        },
                    ],
                },
            ],
            registerFunctionTool: jest.fn(),
        };
        // Another extension edits the message while the variable write is awaited.
        (globalThis as any).replaceVariables = jest.fn(async () => {
            state.current = edited;
        });
        (globalThis as any).setChatMessages = jest.fn().mockResolvedValue(undefined);

        registerFunction();
        const tool = (globalThis as any).SillyTavern.registerFunctionTool.mock.calls[0][0];
        await tool.action({ analysis: '受到伤害', delta: "_.set('health', 100, 90);//受到伤害" });

        expect((globalThis as any).setChatMessages).toHaveBeenCalledTimes(1);
        const written: string = (globalThis as any).setChatMessages.mock.calls[0][0][0].message;
        expect(written.startsWith(edited)).toBe(true);
        expect(written).toContain('<UpdateVariable>');
        expect(written).toContain('<StatusPlaceHolderImpl/>');
    });
});
