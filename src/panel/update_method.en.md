# Variable update method

Choose how variables are updated so the story model can focus on writing the story.

## Alongside AI output

World-book entries are sent to the AI through SillyTavern's normal flow. The AI includes
variable-update analysis and commands in its reply, and MVU applies those updates.

## Extra-model parsing

This method splits the request: one AI writes the story, then another AI analyzes that story and
updates the variables.

To separate the two tasks, MVU filters world-book entries before sending them through SillyTavern's
normal flow:

- Entries whose names contain `[mvu_plot]` are sent only to the story AI.
- Entries whose names contain `[mvu_update]` are sent only to the variable-update AI.
- Entries containing neither `[mvu_plot]` nor `[mvu_update]` are sent to both AIs.

An MVU character card therefore needs `[mvu_plot]` or `[mvu_update]` in its world-book entry names
to support extra-model parsing.

Cards made with the latest [MVU tutorial](https://stagedog.github.io/络络/教程/手写mvu变量卡/)
support extra-model parsing directly. You can also use that tutorial to adapt older cards.

### Manual retry and incremental repair

- **Retry extra-model parsing** discards this floor's existing variable result and fully parses the
  floor again from the preceding state.
- **Incrementally repair extra-model parsing** preserves changes that were already applied correctly
  and asks the extra model only for absolute corrections to missing or incorrect values. MVU
  previews the patch before applying it, writes confirmed corrections back into this floor's
  `<UpdateVariable>` block, and offers click-to-undo from the success notification.

If the chat, floor, swipe, message text, or variables change while an incremental repair is pending,
MVU discards that result instead of overwriting newer progress.
