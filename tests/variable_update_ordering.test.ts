jest.mock('@/function/is_extra_model_supported', () => ({
    isExtraModelSupported: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/function/update/invoke_extra_model', () => ({
    invokeExtraModelWithStrategy: jest.fn(),
}));

import { invokeExtraModelWithStrategy } from '@/function/update/invoke_extra_model';
import { onMessageReceived } from '@/function/update/on_message_received';
import { handleVariablesInMessage } from '@/function/update_variables';
import { useDataStore } from '@/store';
import { getLastValidVariable } from '@/util';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('variable snapshots after a pending Pi response update', () => {
    let chat: any[];

    beforeEach(() => {
        jest.clearAllMocks();
        const store = useDataStore();
        store.settings.更新方式 = '额外模型解析';
        store.settings.兼容性.更新到聊天变量 = false;
        Object.assign(store.settings.额外模型解析配置, {
            模型来源: '更多',
            应答格式: '聊天消息',
            启用自动请求: true,
        });
        chat = [
            {
                mes: 'previous reply',
                variables: [
                    { stat_data: { score: 0 }, schema: { type: 'object', properties: {} } },
                ],
            },
            { mes: 'assistant reply awaiting its variable update' },
            { mes: 'next user turn', is_user: true },
        ];
        Object.assign((globalThis as any).SillyTavern, { chat, name2: 'Assistant' });
        (globalThis as any).substitudeMacros = jest.fn(value => value);
        (globalThis as any).toastr = { error: jest.fn(), warning: jest.fn(), info: jest.fn() };
        (globalThis as any).getChatMessages.mockImplementation((id: number) =>
            chat[id]
                ? [
                      {
                          message_id: id,
                          message: chat[id].mes,
                          name: chat[id].is_user ? 'User' : 'Assistant',
                          role: chat[id].is_user ? 'user' : 'assistant',
                      },
                  ]
                : []
        );
        (globalThis as any).setChatMessages.mockImplementation(async (messages: any[]) => {
            for (const message of messages) {
                if (message.message !== undefined) chat[message.message_id].mes = message.message;
            }
        });
        (globalThis as any).updateVariablesWith = jest.fn(async (update, { message_id }) => {
            chat[message_id].variables = [update(chat[message_id].variables?.[0] ?? {})];
        });
    });

    test('copies score=1 into the next user message only after the assistant update is saved', async () => {
        const provider_started = deferred<void>();
        const provider = deferred<string>();
        const write_started = deferred<void>();
        const write = deferred<void>();
        jest.mocked(invokeExtraModelWithStrategy).mockImplementation(() => {
            provider_started.resolve();
            return provider.promise;
        });
        (globalThis as any).updateVariablesWith.mockImplementation(
            async (
                update: (variables: Record<string, any>) => Record<string, any>,
                { message_id }: { message_id: number }
            ) => {
                if (message_id === 1) {
                    write_started.resolve();
                    await write.promise;
                }
                chat[message_id].variables = [update(chat[message_id].variables?.[0] ?? {})];
            }
        );

        const assistant_update = onMessageReceived(1);
        await provider_started.promise;
        const user_snapshot = handleVariablesInMessage(2);
        await Promise.resolve();
        expect(chat[2].variables).toBeUndefined();

        provider.resolve("<UpdateVariable>\n_.set('score', 1);\n</UpdateVariable>");
        await write_started.promise;
        expect(chat[2].variables).toBeUndefined();
        write.resolve();
        await Promise.all([assistant_update, user_snapshot]);

        expect(chat[1].variables[0].stat_data.score).toBe(1);
        expect(chat[2].variables[0].stat_data.score).toBe(1);
        expect(getLastValidVariable(3)?.stat_data.score).toBe(1);
    });

    test('releases waiting user snapshots when the provider fails', async () => {
        const started = deferred<void>();
        const provider = deferred<string>();
        const error = new Error('provider failed');
        jest.mocked(invokeExtraModelWithStrategy).mockImplementation(() => {
            started.resolve();
            return provider.promise;
        });
        const assistant_update = onMessageReceived(1);
        const failure = expect(assistant_update).rejects.toBe(error);
        await started.promise;
        const user_snapshot = handleVariablesInMessage(2);
        provider.reject(error);
        await Promise.all([failure, user_snapshot]);

        expect(chat[2].variables[0].stat_data.score).toBe(0);
    });
});
