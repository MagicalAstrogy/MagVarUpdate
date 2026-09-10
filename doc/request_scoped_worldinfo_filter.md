# 按请求筛选世界书

本特性独立基于 `origin/beta`，不依赖 Pi 请求捕获。

## 调用与识别

每次 `invokeExtraModel` 都分配或沿用自己的 `generation_id`。在 MVU 已启用且
`is_during_extra_analysis` 为真时，登记在途请求及过滤配置快照，在 `finally`
中移除。成功、失败和取消都经过相同清理路径。

`generate()` / `generateRaw()` 的 `overrides.char_description`
在保留原描述的基础上附加随机标记。助手会把这个覆盖值传给本次
`globalScanData.characterDescription`。不修改角色卡、世界书本体、世界书缓存或共享注入提示词。

有在途请求且额外分析开关打开时，`WORLDINFO_ENTRIES_LOADED`：

1. 保存四组 lore 的 `world/uid/comment`，包含禁用及尚未激活的条目。
2. 加入一个禁用的元数据条目，携带本次扫描的普通生成策略与在途请求快照。
3. 为每个在途请求加入一个识别条目，关键词为该请求的唯一标记，开启角色描述匹配。
4. 保留所有业务条目；不为业务条目增加字段，避免改变 ST 计算的条目哈希及 sticky/cooldown。

识别条目内容为空，忽略预算，禁止递归，概率为 `-1`。它只会出现在 `WORLDINFO_SCAN_DONE.new.all`
的匹配候选中，永远不通过概率检查，即便随机数为 0。因此不进入真正激活集合，也不占世界书预算、最低激活数或增加递归轮次。它会消耗一次随机数抽取，因此不保证与旧流程逐次相同的概率抽样结果。

`WORLDINFO_SCAN_DONE`
首次回调从候选探针恢复请求身份：恰好匹配一个在途请求时使用其快照，否则按普通生成处理。以最初保存的全部条目计算过滤结果，因此某个
`[mvu_update]` / `[mvu_plot]` 条目未激活或被禁用，不会导致整本支持情况被误判。

回调清理探针及被过滤的 `sortedEntries`、`activated.entries`、`new.all`、
`new.successful`，并维护公开的递归文本计数。后续轮次通过以 `sortedEntries` 为键的 `WeakMap`
继续使用同一策略，不依赖当前全局开关或在途列表是否已改变。

没有在途请求或不在额外分析期间时，沿用原有的扫描前普通生成过滤。四组 lore 都为空时不插入探针，保留 ST 的空世界书短路行为。

## 提示词清理

有登记中的生成调用时，安装首位、同步的 `CHAT_COMPLETION_PROMPT_READY`
监听器，清除描述中的标记；`CHAT_COMPLETION_SETTINGS_READY`
再作清理兜底。支持普通字符串和多模态消息的文本块，并移除原本仅含标记的空消息。最后一个登记调用结束后卸载清理监听器。清理订阅独立于聊天级过滤订阅，切换聊天时仍可以处理尚在构建的请求。

## 与提前过滤的差异

此方案实现请求归属隔离，但不承诺与扫描前过滤完全等价：

- 第一轮的包含组竞争和世界书预算检查已经完成。事后删除条目不会自动补回被挤掉的条目。
- ST 在 `WORLDINFO_SCAN_DONE` 之前更新私有递归缓冲区。公开的 `activated.text`
  可以更新，但已经进入私有缓冲区的被过滤文本仍可能触发其他条目。
- 描述中的短标记在提示词组装后才删除，因此可能影响临界情况下的 token 预算与历史截断。
- 本特性隔离世界书筛选；工具注册、请求参数覆盖及其他全局状态不在本次改动范围内。

如需完整保留扫描前语义，需要宿主把请求上下文透传到原始世界书加载事件。

## 验证

单元测试覆盖配置不可变性、并发策略快照、普通请求隔离、未激活条目的整本支持判断、多轮清理、开关行为以及消息标记清理。

宿主集成测试执行本机 SillyTavern 的真实加载、扫描、预算、定时效果和递归函数，以及仓库酒馆助手的
`processWorldInfo`。仅模拟世界书 I/O、宏/正则和 tokenizer，不发模型请求。当前验证环境为 ST
1.18.0；有其他扩展改写这些事件时仍需联调。

```sh
npm test -- --runInBand tests/worldinfo_request_filter.test.ts
MVU_ST_ROOT=/path/to/SillyTavern npm test -- --runInBand tests/worldinfo_host.integration.test.ts
```

未配置 `MVU_ST_ROOT` 时，集成测试也会尝试本机 `~/silly/SillyTavern2`；没有宿主源码则跳过。
