import { useDataStore } from '@/store';
import { compare } from 'compare-versions';

export const MIN_FUNCTION_CALLING_TAVERN_HELPER_VERSION = '4.8.4';

export function getFunctionCallingApiVersionUnsupportedMessage(): string | null {
    const version = useDataStore().versions.tavernhelper;
    if (version === '' || compare(version, MIN_FUNCTION_CALLING_TAVERN_HELPER_VERSION, '>=')) {
        return null;
    }
    return `当前酒馆助手版本为 ${version}，工具调用需要酒馆助手 ${MIN_FUNCTION_CALLING_TAVERN_HELPER_VERSION} 或更高版本`;
}

export function isFunctionCallingApiVersionSupported() {
    return getFunctionCallingApiVersionUnsupportedMessage() === null;
}

export function isFunctionCallingSupported() {
    if (!isFunctionCallingApiVersionSupported()) {
        return false;
    }
    if (!SillyTavern.ToolManager.isToolCallingSupported()) {
        return false;
    }
    return true;
}
