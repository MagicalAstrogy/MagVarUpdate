import { watchPreferredChatSync } from '@/function/chat_lifecycle';
import { nextTick, ref } from 'vue';

describe('preferred chat synchronization', () => {
    test('forces the current chat to resynchronize when an instance becomes preferred', async () => {
        const should_enable = ref(false);
        let current_chat_id = 'chat-a';
        const transition_to_chat = jest.fn().mockResolvedValue(undefined);
        const stop = watchPreferredChatSync(
            () => should_enable.value,
            transition_to_chat,
            () => current_chat_id
        );

        current_chat_id = 'chat-b';
        should_enable.value = true;
        await nextTick();

        expect(transition_to_chat).toHaveBeenCalledTimes(1);
        expect(transition_to_chat).toHaveBeenCalledWith('chat-b', true);

        should_enable.value = false;
        await nextTick();
        expect(transition_to_chat).toHaveBeenCalledTimes(1);

        stop();
    });
});
