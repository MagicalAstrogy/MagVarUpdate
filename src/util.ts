let sillytavern_version: string = '1.0.0';
export async function init_silltavern_version(): Promise<void> {
    sillytavern_version = await fetch('/version')
        .then(res => res.json())
        .then(data => data.pkgVersion)
        .catch(() => '1.0.0');
}
export function get_sillytavern_version(): string {
    return sillytavern_version;
}

export function is_toolcall_supported() {
    if (!SillyTavern.ToolManager.isToolCallingSupported()) {
        return false;
    }
    if (SillyTavern.chatCompletionSettings.function_calling === false) {
        return false;
    }
    return true;
}

export const is_jest_environment =
    // @ts-expect-error maybe undefined
    typeof jest !== 'undefined' ||
    // @ts-expect-error maybe undefined
    (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test');
