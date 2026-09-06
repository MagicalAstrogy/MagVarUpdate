# Jailbreak strategy

Choose the prompts used by the variable-update model. This setting and its related options are saved
with the API profile.

## Use built-in jailbreak

Use MVU's built-in variable-update prompts. Thanks to @离 for the jailbreak prompt, designed mainly
for Gemini and Claude and usable with other models.

## Use current preset

Use the prompts in SillyTavern's current preset. If the preset asks the model to continue the story,
the variable-update model may do so too, producing updates for later events instead of the current
reply.

## Use another preset

Choose a saved preset and use its prompts without switching SillyTavern's active preset.

- Save your preset edits first; unsaved changes are not read here.
- Regex processing continues to use SillyTavern's current settings.
- The model, API URL, and other connection settings still come from Model source.
- Only the selected preset's prompts are used. Its extra scripts and API settings do not apply.
