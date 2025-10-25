let sillytavern_version: string = '1.0.0';
export async function initSillyTavernVersion(): Promise<void> {
    sillytavern_version = await fetch('/version')
        .then(res => res.json())
        .then(data => data.pkgVersion)
        .catch(() => '1.0.0');
}
export function getSillyTavernVersion(): string {
    return sillytavern_version;
}

export function isFunctionCallingSupported() {
    if (!SillyTavern.ToolManager.isToolCallingSupported()) {
        return false;
    }
    if (SillyTavern.chatCompletionSettings.function_calling === false) {
        return false;
    }
    return true;
}

declare const jest: any;
declare const process: any;

export const is_jest_environment =
    typeof jest !== 'undefined' ||
    (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test');

export const saveChatDebounced = _.debounce(SillyTavern.saveChat, 1000);
