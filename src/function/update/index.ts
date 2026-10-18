import { onMessageReceived } from '@/function/update/on_message_received';
import { clearPiRequestControllers } from '@/function/update/pi/controller_registry';
import { handleVariablesInMessage } from '@/function/update_variables';
import { is_jest_environment } from '@/jest';
import { controlledStoppableEventOn } from '@/util';

/**
 * 注册消息接收和变量处理监听，并返回卸载函数。
 * 卸载时先取消 Pi 请求及提示词捕获，再移除监听，避免并发完成的捕获重新发起请求。
 */
export function initResponse() {
    const controller = new AbortController();
    const receive = (message_id: number) =>
        onMessageReceived(message_id, { signal: controller.signal });
    // receive 必须在当次 MESSAGE_RECEIVED 的异步调用链中启动，并返回 Promise 供宿主等待。
    // 窗口内的重复事件直接丢弃，禁止定时器在尾部补调，避免脱离原事件调用链后
    // 再读取已经变化的聊天或配置状态。
    const throttled_receive = _.throttle(receive, 3000, { trailing: false });
    const stop_list: Array<() => void> = [];
    stop_list.push(
        controlledStoppableEventOn(tavern_events.MESSAGE_SENT, handleVariablesInMessage)
    );
    stop_list.push(
        controlledStoppableEventOn(
            tavern_events.MESSAGE_RECEIVED,
            is_jest_environment ? receive : throttled_receive
        )
    );
    return () => {
        controller.abort();
        throttled_receive.cancel();
        // Tombstone active capture attempts before tearing down response listeners. A capture
        // that settles concurrently must not be able to register a fresh Pi provider request.
        clearPiRequestControllers();
        stop_list.forEach(stop => stop());
    };
}
