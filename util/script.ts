export function teleportStyle(
  append_to: JQuery.Selector | JQuery.htmlString | JQuery.TypeOrArray<Element | DocumentFragment> | JQuery = 'head',
): { destroy: () => void } {
  const $div = $(`<div>`)
    .attr('script_id', getScriptId())
    .append($(`head > style`, document).clone())
    .appendTo(append_to);

  return {
    destroy: () => $div.remove(),
  };
}

export function createScriptIdDiv(): JQuery<HTMLDivElement> {
  return $('<div>').attr('script_id', getScriptId()) as JQuery<HTMLDivElement>;
}

export function registerAsUniqueScript(id: string): {
  unregister: () => void;
  getPreferredScriptId: () => string | undefined;
  listenPreferenceState: (callback: (perferred_script_id: string) => void) => EventOnReturn;
} {
  const script_id = getScriptId();
  const path = `th_unique_check.${id}`;

  const getPreferredScriptId = () => {
    const registered_scripts = _.get(window.parent, path, new Set<string>());
    return _($('#tavern_helper').find('div[data-script-id]').toArray())
      .map(element => String($(element).attr('data-script-id')))
      .filter(element => registered_scripts.has(element))
      .last();
  };

  _.update(window.parent, path, (value: Set<string> | undefined) => {
    if (value === undefined) {
      return new Set([script_id]);
    }
    value.add(script_id);
    return value;
  });
  eventEmit(path, getPreferredScriptId());

  return {
    unregister: () => {
      _.update(window.parent, path, (value: Set<string> | undefined) => {
        if (value !== undefined) {
          value.delete(script_id);
        }
        return value;
      });
      eventEmit(path, getPreferredScriptId());
    },
    getPreferredScriptId,
    listenPreferenceState: (callback: (enabled_script_id: string) => void) => eventOn(path, callback),
  };
}
