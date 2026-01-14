export declare function getIsExtraModelSupported(): boolean;
export declare function setIsExtraModelSupported(value: boolean): void;
export declare function handlePromptFilter(lores: {
    globalLore: Record<string, any>[];
    characterLore: Record<string, any>[];
    chatLore: Record<string, any>[];
    personaLore: Record<string, any>[];
}): Promise<void>;
