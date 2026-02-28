export declare function teleportStyle(append_to?: JQuery.Selector | JQuery.htmlString | JQuery.TypeOrArray<Element | DocumentFragment> | JQuery): {
    destroy: () => void;
};
export declare function createScriptIdDiv(): JQuery<HTMLDivElement>;
export declare function registerAsUniqueScript(id: string): {
    unregister: () => void;
    getPreferredScriptId: () => string | undefined;
    listenPreferenceState: (callback: (perferred_script_id: string) => void) => EventOnReturn;
};
