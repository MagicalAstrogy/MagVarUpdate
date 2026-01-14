interface Button {
    name: string;
    function: (() => void) | (() => Promise<void>);
    is_legacy?: boolean;
}
type OnMessageReceived = (message_id: number, reason?: any) => Promise<void>;
export declare function SetReceivedCallbackFn(fn: OnMessageReceived): void;
export declare const buttons: Button[];
export declare function registerButtons(): void;
export {};
