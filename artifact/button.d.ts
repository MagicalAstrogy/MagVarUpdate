interface Button {
    name: string;
    function: (() => void) | (() => Promise<void>);
}
export declare const buttons: Button[];
export declare function registerButtons(): void;
export {};
