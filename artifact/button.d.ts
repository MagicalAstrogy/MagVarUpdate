interface Button {
    name: string;
    function: (() => void) | (() => Promise<void>);
}
type OnMessageReceived = (message_id: number) => Promise<void>;
export declare function SetReceivedCallbackFn(fn: OnMessageReceived): void;
export declare function SetExtraModelSupported(is_support: boolean): void;
export declare const buttons: Button[];
export declare function registerButtons(): void;
export {};
