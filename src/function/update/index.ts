import { onMessageReceived } from '@/function/update/on_message_received';
import { clearPiRequestControllers } from '@/function/update/pi/controller_registry';
import { handleVariablesInMessage } from '@/function/update_variables';
import { controlledStoppableEventOn } from '@/util';

/**
 * 注册消息接收和变量处理监听，并返回卸载函数。
 * 卸载时先取消 Pi 请求及提示词捕获，再移除监听，避免并发完成的捕获重新发起请求。
 */
export function initResponse() {
    const controller = new AbortController();
    const stop_list: Array<() => void> = [];
    stop_list.push(
        controlledStoppableEventOn(tavern_events.MESSAGE_SENT, handleVariablesInMessage)
    );
    stop_list.push(
        // 接收事件必须直接执行：节流的尾调用可能晚于对应渲染事件，导致临时监听漏接。
        controlledStoppableEventOn(tavern_events.MESSAGE_RECEIVED, message_id =>
            onMessageReceived(message_id, { signal: controller.signal })
        )
    );
    return () => {
        controller.abort();
        // Tombstone active capture attempts before tearing down response listeners. A capture
        // that settles concurrently must not be able to register a fresh Pi provider request.
        clearPiRequestControllers();
        stop_list.forEach(stop => stop());
    };
}
