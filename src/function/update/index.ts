import { is_jest_environment } from '@/jest';

import { onMessageReceived } from '@/function/update/on_message_received';
import { clearPiRequestControllers } from '@/function/update/pi/controller_registry';
import { handleVariablesInMessage } from '@/function/update_variables';
import { controlledStoppableEventOn } from '@/util';

/**
 * 注册消息接收和变量处理监听，并返回卸载函数。
 * 卸载时先取消 Pi 请求及提示词捕获，再移除监听，避免并发完成的捕获重新发起请求。
 */
export function initResponse() {
    const stop_list: Array<() => void> = [];
    stop_list.push(
        controlledStoppableEventOn(tavern_events.MESSAGE_SENT, handleVariablesInMessage)
    );
    stop_list.push(
        controlledStoppableEventOn(
            tavern_events.MESSAGE_RECEIVED,
            is_jest_environment ? onMessageReceived : _.throttle(onMessageReceived, 3000)
        )
    );
    return () => {
        // Tombstone active capture attempts before tearing down response listeners. A capture
        // that settles concurrently must not be able to register a fresh Pi provider request.
        clearPiRequestControllers();
        stop_list.forEach(stop => stop());
    };
}
