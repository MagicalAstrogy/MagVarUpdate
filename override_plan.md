# 角色卡配置覆盖方案

## 目标

允许角色卡作者在角色卡绑定的世界书中提供 MVU 配置。运行时在用户全局配置之上应用角色卡配置，同时在 UI 中明确展示角色卡配置和最终生效值。

本功能只支持以下字段：

- `更新方式`
- `额外模型解析配置.启用自动请求`
- `额外模型解析配置.世界书条目白名单正则`
- `额外模型解析配置.世界书条目黑名单正则`
- `兼容性.更新到聊天变量`
- `兼容性.sendas不视为user消息`

其中，白名单和黑名单采用叠加规则；其他字段采用覆盖规则。

## 配置来源

不在角色卡扩展字段或角色变量中保存配置。是否存在角色卡配置，通过扫描当前角色卡唯一的
`character_worldbook` 判断。SillyTavern 保证当前角色卡只有一个 `character_worldbook`。

世界书中使用 comment 精确等于 `[config_override]`
的条目承载配置，匹配时忽略首尾空白和大小写。该条目始终处于关闭状态，加载逻辑必须主动扫描
`character_worldbook` 的全部条目，不能依赖世界书激活结果。

条目正文是一个自描述 JSON 文档：

- 顶层配置字段符合 `CharacterSettingsOverride`。
- 顶层可以包含 `schema`，直接内嵌 `CharacterSettingsOverride` 的 JSON Schema 类型信息。
- `schema` 只负责描述和校验配置，不参与最终配置合并。
- 加载已有配置时不强制要求 `schema` 存在；由 MVU 创建或保存的 JSON 必须包含
  `schema`，并把它放在顶层最后，方便人工查看和编辑。

示例：

```json
{
    "更新方式": "额外模型解析",
    "额外模型解析配置": {
        "启用自动请求": true,
        "世界书条目白名单正则": "角色|地点",
        "世界书条目黑名单正则": "临时|禁用"
    },
    "兼容性": {
        "更新到聊天变量": true,
        "sendas不视为user消息": true
    },
    "schema": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "CharacterSettingsOverride",
        "type": "object",
        "additionalProperties": true,
        "properties": {
            "更新方式": {
                "type": "string",
                "enum": ["随AI输出", "额外模型解析"]
            },
            "额外模型解析配置": {
                "type": "object",
                "additionalProperties": true,
                "properties": {
                    "启用自动请求": {
                        "type": "boolean"
                    },
                    "世界书条目白名单正则": {
                        "type": "string"
                    },
                    "世界书条目黑名单正则": {
                        "type": "string"
                    }
                }
            },
            "兼容性": {
                "type": "object",
                "additionalProperties": true,
                "properties": {
                    "更新到聊天变量": {
                        "type": "boolean"
                    },
                    "sendas不视为user消息": {
                        "type": "boolean"
                    }
                }
            }
        }
    }
}
```

`[config_override]` 是关闭状态的控制条目，因此不会作为普通世界书内容发送给剧情模型或额外解析模型。

## 数据结构

```ts
type CharacterSettingsOverride = {
    更新方式?: '随AI输出' | '额外模型解析';

    额外模型解析配置?: {
        启用自动请求?: boolean;
        世界书条目白名单正则?: string;
        世界书条目黑名单正则?: string;
    };

    兼容性?: {
        更新到聊天变量?: boolean;
        sendas不视为user消息?: boolean;
    };
};

type CharacterSettingsOverrideDocument = CharacterSettingsOverride & {
    /**
     * CharacterSettingsOverride 的内嵌 JSON Schema。
     * 在原始 JSON 中必须排列在最后。
     */
    schema?: Record<string, unknown>;
};
```

解析时将 `schema` 与配置字段分离，再使用内置的 Zod schema 校验配置字段。`CharacterSettingsOverride`
及其嵌套对象都使用 loose/passthrough 模式：

- 已知字段仍按声明类型校验。
- 未知字段允许存在并原样保留。
- 未知字段不参与 MVU 配置覆盖，但保存时不能被 UI 意外删除。
- 内嵌 JSON Schema 的 `additionalProperties` 同样设为 `true`。

内嵌 `schema` 是可选兼容字段。缺少 `schema`
不影响配置加载；MVU 下一次自动保存该条目时会补齐当前版本的完整 schema。若 `schema`
存在，则从运行时覆盖字段中剥离，不参与配置合并。

配置字段统一使用 `sendas不视为user消息`。现有代码中的 `sandas不视为user消息`
是历史拼写错误，实现本功能时需要迁移或兼容读取旧的用户全局配置，并在运行时归一化为正确字段名。

## 配置加载

角色卡配置按以下流程加载：

1. 获取当前角色卡唯一的 `character_worldbook`。
2. 主动读取该世界书的全部条目，包括关闭条目。
3. 按世界书 API 返回顺序，查找 comment 去除首尾空白后精确等于 `[config_override]`
   的关闭条目，匹配时忽略大小写。
4. 如果只找到一个条目，处理该条目。
5. 如果找到多个条目，只处理扫描到的第一个，并通过 toastr 警告存在重复配置；其余条目不解析、不合并。
6. 解析目标条目正文中的 JSON。
7. 如果存在 `schema`，将其从参与运行时覆盖的配置字段中剥离；缺少 `schema` 不算检查失败。
8. 使用 loose/passthrough 的 `CharacterSettingsOverride` Zod schema 校验配置数据，同时保留未知字段。
9. 记录对应世界书、条目标识及当前 `content` 作为预期值，供自动保存前检查并发修改。
10. 将解析结果同时载入 UI 草稿和当前运行时配置。

未找到 `[config_override]` 时，角色卡配置为空，全部使用用户全局配置。

JSON 或已知字段检查失败时，将其视为角色卡配置不存在，不应用其中任何配置，并通过控制台和 toastr 提示条目来源及错误原因。即使检查失败，仍记录原条目标识和
`content` 预期值，用户修改表单后可通过自动保存修复该条目。缺少内嵌 `schema` 不属于失败。

`[config_override]` 始终为关闭条目，这是角色卡格式约定。加载器不应修改或自动开启该条目。

### 读取时机与自动保存协调

读取角色卡配置至少发生在：

- MVU 初始化时。
- 切换聊天后。
- SillyTavern 发出 `tavern_events.WORLDINFO_UPDATED` 时；仅当事件中的世界书名称等于当前角色卡绑定的
  `character_worldbook` 才尝试重新读取。
- MVU 自己成功保存角色卡配置后。

SillyTavern 的 `WORLDINFO_UPDATED`
在世界书保存请求完成后触发，回调参数为世界书名称和本次保存的数据。`WORLDINFO_SETTINGS_UPDATED`
表示全局世界书扫描设置变化，不表示某个世界书条目内容已经改变；`WORLDINFO_ENTRIES_LOADED`
表示生成流程已加载待扫描条目，也不作为配置编辑完成事件。

每次读取后保存 UI 草稿、条目标识和对应 `content` 的预期值。

外部 `WORLDINFO_UPDATED` 属于当前 `character_worldbook` 时：

- 没有待执行或正在执行的自动保存任务：重新读取配置。
- 存在待执行或正在执行的自动保存任务：暂不重新读取，保留当前 UI 草稿；随后由自动保存前的 `content`
  预期值检查发现冲突并弹框处理。

MVU 自己保存世界书时同样会触发
`WORLDINFO_UPDATED`。实现中需要用保存中标记或修订号识别本次自保存事件，避免把尚在进行的 UI 修改误判为外部修改；保存完成后更新预期
`content`，并在没有更新版本草稿等待保存时重新读取。

## 配置写入

“当前角色卡配置”组件同时负责展示和编辑
`CharacterSettingsOverride`。组件不提供显式保存按钮；修改任意字段后立即更新运行时配置，并自动写入世界书。

自动保存时：

1. 确认当前角色卡存在 `character_worldbook`；不存在时禁止写入。
2. 将 UI 草稿转换成 `CharacterSettingsOverride`，移除“跟随用户配置”的普通字段以及空的嵌套对象。
3. 白名单和黑名单输入为空时，不写入对应角色卡规则。
4. 将 UI 支持的已知字段合并回读取时保留的 passthrough 数据，不能删除未知字段。
5. 使用内置 loose/passthrough schema 校验待保存配置。
6. 在配置对象最后追加完整的 `schema` 属性。
7. 将结果格式化为便于人工阅读的 JSON。
8. 保存前重新读取目标 `character_worldbook`，根据记录的条目标识定位对应条目。
9. 检查对应条目的当前 `content` 是否仍与上次读取或上次成功保存的预期值完全一致：
    - 如果原本没有条目，则当前也必须仍然不存在匹配条目。
    - 如果原本存在条目，则对应条目必须仍然存在，且 `content` 必须相同。
10. 检查不符合预期时，暂停本次自动保存并弹出确认框，说明目标条目已被其他来源修改，询问是否使用当前 UI 配置覆盖：
    - 用户确认覆盖：继续写入当前 UI 草稿。
    - 用户拒绝覆盖或关闭弹窗：放弃本次 UI 草稿，重新读取并应用外部最新配置。
    - 弹窗本身会阻止正常 UI 修改，不额外实现弹窗期间的草稿修订协调；若用户通过其他方式强行修改，后果由用户自行承担。
11. 检查符合预期，或用户在冲突确认框中选择覆盖时：
    - 如果不存在 `[config_override]`，新建一个 comment 为 `[config_override]`
      的关闭条目；即使没有任何实际配置，也创建仅含 `schema` 的条目。
    - 如果已经存在条目，更新读取时对应的第一个条目。
    - 如果存在多个条目，仍只更新第一个；保持其余条目不变，并发出 toastr 警告。
12. 写入成功后更新条目标识和预期
    `content`。如果保存期间没有产生更新版本的 UI 草稿，则重新读取配置；否则继续保存最新草稿。

新建的 `[config_override]` 必须从创建时就是关闭状态，不能先创建开启条目再修改状态。

清除最后一个实际配置字段时不删除 `[config_override]`，而是保存为仅含 `schema`
的关闭条目。schema-only 条目是合法的空配置，标题状态为“未启用”。

内嵌 JSON Schema 应与运行时使用的 `CharacterSettingsOverride` Zod
schema 共用同一类型来源，避免两套定义逐渐不一致。序列化时显式最后追加
`schema`，不要依赖普通对象深度合并后的属性顺序。

任何 UI 配置字段发生变化时：

- 立即重新计算运行时配置，不等待保存。
- 增加内部草稿修订号。
- 触发自动保存。下拉框和复选项可以立即保存；正则文本输入使用短防抖，并确保保存任务串行执行。

## 配置合并规则

设置状态分为三层：

```ts
globalSettings; // 用户全局配置，持久化到 extensionSettings
characterSettingsDraft; // UI 当前显示的角色卡配置草稿
characterSettingsOverride; // 从草稿提取出的受支持运行时字段
effectiveSettings; // 运行逻辑实际读取的配置
```

普通字段的优先级为：

```text
默认配置 < 用户全局配置 < 角色卡配置
```

普通字段只在角色卡 JSON 中实际存在时才覆盖用户值：

- `更新方式`
- `额外模型解析配置.启用自动请求`
- `兼容性.更新到聊天变量`
- `兼容性.sendas不视为user消息`

合并必须按字段进行深度合并，不能用角色卡中的局部对象替换整个 `额外模型解析配置` 或 `兼容性`。

## 白名单和黑名单规则

角色卡白名单、黑名单不替换用户配置，而是与对应的用户规则叠加。

定义：

```text
Wg = 用户全局白名单
Wc = 角色卡白名单
Bg = 用户全局黑名单
Bc = 角色卡黑名单
```

### 白名单

只要存在任意有效白名单，条目必须匹配至少一个白名单才能保留：

```text
白名单通过 = match(Wg) OR match(Wc)
```

没有配置任何有效白名单时，白名单不限制条目。

### 黑名单

条目匹配任意一个黑名单即被排除：

```text
黑名单命中 = match(Bg) OR match(Bc)
```

### 最终判断

```text
保留条目 = 白名单通过 AND NOT 黑名单命中
```

现有 `[mvu_update]` 条目绕过 comment 白名单和黑名单的行为保持不变。

全局和角色卡正则分别编译、分别校验，不通过拼接字符串生成一个新正则。某一来源的正则无效时，只忽略该来源，并在错误提示中标明“用户全局配置”或“角色卡配置”。

## 筛选结果与来源记录

现有的 `上次世界书条目过滤结果` 除了记录白名单或黑名单原因，还需要记录导致筛选的配置来源。

建议结构：

```ts
type EntryCommentFilterSource = '用户全局配置' | '角色卡配置';

type EntryCommentFilterResult = {
    lore: 'globalLore' | 'characterLore' | 'chatLore' | 'personaLore';
    world: string;
    comment: string;
    reason: '白名单' | '黑名单';
    sources: EntryCommentFilterSource[];
};
```

来源记录规则：

- 因白名单未通过而排除：
    - `sources` 记录当前参与判断的全部有效白名单来源。
    - 若全局和角色卡均配置了有效白名单，且条目两者都未匹配，则记录两个来源。
- 因黑名单命中而排除：
    - `sources` 只记录实际匹配该条目的黑名单来源。
    - 如果两个来源都匹配，则记录两个来源。
- 同时存在白名单未通过和黑名单命中时，保持当前筛选顺序，优先记录白名单原因。

控制台日志和“查看上次分析被筛选的条目”弹窗都展示 `sources`，例如：

```text
原因：黑名单
配置来源：角色卡配置
```

或：

```text
原因：白名单
配置来源：用户全局配置、角色卡配置
```

## UI 方案

现有设置控件继续编辑用户全局配置。“当前角色卡配置”组件负责编辑世界书中的
`[config_override]`，并同时展示用户值、角色卡值和最终生效值。

在 MVU 设置面板增加默认收起的“当前角色卡配置”区块。标题始终携带当前状态：

```text
当前角色卡配置（未启用）
```

或：

```text
当前角色卡配置（覆盖中）
```

展开后的内容：

```text
角色：角色名称
角色世界书：世界书名称
配置条目：[config_override] / 尚未创建

更新方式
[ 跟随用户配置（当前：随AI输出） ▼ ]
当前生效：随AI输出

额外模型解析
自动请求：[ 跟随用户配置（当前：开启） ▼ ]
角色卡白名单：[                       ]
生效规则：用户白名单 OR 角色卡白名单
角色卡黑名单：[                       ]
生效规则：用户黑名单 OR 角色卡黑名单

兼容性
变量更新到聊天变量：[ 跟随用户配置（当前：关闭） ▼ ]
sendas 不视为 user 消息：[ 跟随用户配置（当前：关闭） ▼ ]
```

UI 要点：

- 组件默认处于收起状态。
- 标题状态为“未启用”或“覆盖中”，用户不展开组件也能确认角色卡配置是否正在生效。
- 满足以下任意情况时显示“覆盖中”：
    - 至少一个普通字段存在于角色卡配置中。即使角色卡值当前恰好等于用户值，也仍算“覆盖中”。
    - 存在有效的角色卡白名单规则。
    - 存在有效的角色卡黑名单规则。
- 以下情况显示“未启用”：
    - 当前角色卡没有绑定 `character_worldbook`。
    - 没有 `[config_override]` 条目。
    - 条目中没有任何实际配置字段，例如只包含 `schema`。
    - JSON 或配置校验失败，角色卡配置未被应用。
- 没有绑定 `character_worldbook`
  时，整个组件不可用，所有输入禁用，并显示“当前角色卡未绑定角色世界书”。
- 已绑定 `character_worldbook`、但没有 `[config_override]`
  时，组件仍然可编辑，并显示“修改配置时将自动创建关闭的 `[config_override]` 条目”。
- 第一次修改配置时自动创建条目，之后自动保存更新扫描到的第一个条目；空草稿也允许创建 schema-only 条目。
- 清除最后一个配置字段后保留 schema-only 条目，并显示“未启用”。
- 编辑组件中的任意字段会立即更新运行时配置并自动写入世界书。
- 自动保存前如果检测到对应条目的 `content`
  不符合预期，则弹框询问是否覆盖；确认后写入当前配置，拒绝或关闭弹窗后加载外部最新配置。
- 普通覆盖字段同时展示用户值、角色卡值和最终生效值。
- 普通字段采用三态或枚举选择；角色卡没有提供某字段时显示“跟随用户配置”。
- 白名单和黑名单明确显示为 `OR` 关系，不能显示成角色卡覆盖用户配置。
- 用户全局配置输入框保持可编辑。
- 现有全局设置中，被角色卡覆盖的普通字段旁显示“角色卡覆盖”标识，避免用户误以为修改全局值会立即改变当前角色的生效值。
- 现有全局白名单和黑名单旁不显示“覆盖”，而显示“角色卡规则叠加”标识。
- UI 可标明 `[config_override]` 是关闭条目；关闭状态不会导致配置失效，因为 MVU 会主动扫描它。
- “查看上次分析被筛选的条目”弹窗增加“配置来源”列。

对现有面板文件的预期修改：

- `Panel.vue`
    - 在 `Version` 之后挂载新的角色卡配置组件。
    - 组件使用默认关闭的折叠区块，标题展示“未启用”或“覆盖中”。
- `Update.vue`、`update/Method.vue`
    - `更新方式` 被角色卡配置时显示“角色卡覆盖”。
    - 当用户全局配置或最终生效配置任一为“额外模型解析”时，展示额外模型配置区。
- `update/Request.vue`
    - `启用自动请求` 被角色卡配置时显示“角色卡覆盖”。
- `update/Prompt.vue`
    - 全局白名单或黑名单存在对应角色卡规则时显示“角色卡规则叠加”。
- `Compatibility.vue`
    - `更新到聊天变量`、`sendas 不视为 user 消息` 被角色卡配置时显示“角色卡覆盖”。

## Store 和运行时调整

建议在 store 中增加：

```ts
has_character_worldbook;
character_settings_draft;
character_settings_override;
character_settings_override_source;
character_settings_entry_uid;
character_settings_expected_content;
character_settings_draft_revision;
has_pending_character_settings_save;
is_character_settings_saving;
effective_settings;
```

其中：

- `settings` 继续表示并持久化用户全局配置。
- `has_character_worldbook` 控制角色卡配置组件是否可用。
- `character_settings_draft` 保存组件当前显示和编辑的 loose/passthrough 完整草稿。
- `character_settings_override` 从草稿提取受支持字段，供运行时应用。
- `character_settings_override_source` 保存世界书及条目信息，供错误提示和 UI 展示。
- `character_settings_entry_uid` 标识上次读取或创建的目标条目。
- `character_settings_expected_content` 保存目标条目上次读取或成功保存后的
  `content`，供自动保存前做乐观检查。
- `character_settings_draft_revision` 防止较早的异步保存结果覆盖更新版本的 UI 草稿。
- `has_pending_character_settings_save` 表示存在尚未执行的防抖保存，阻止 `WORLDINFO_UPDATED`
  提前重载并丢弃草稿。
- `is_character_settings_saving` 用于识别 MVU 自己触发的 `WORLDINFO_UPDATED`。
- `effective_settings` 是只读计算结果，业务运行逻辑从这里读取配置。

`effective_settings`
根据当前 UI 草稿计算，而不是只根据已保存的世界书内容计算。白名单和黑名单筛选不直接读取合并后的单个字符串，而是分别读取用户正则和角色卡正则，以便实现 OR 判断并保留来源信息。

## 需要覆盖的测试

- 没有 `[config_override]` 时完全沿用用户配置。
- 组件初次渲染时默认收起。
- 修改任意 UI 配置后运行时立即使用草稿，并触发自动保存。
- 正则文本输入防抖保存，多个保存任务串行执行。
- 较早的异步保存结果不会覆盖更新版本草稿。
- `WORLDINFO_UPDATED` 属于当前 `character_worldbook` 时重新读取配置。
- `WORLDINFO_UPDATED` 属于其他世界书时不重新读取。
- 当前世界书触发
  `WORLDINFO_UPDATED`、但存在待保存或正在保存任务时不重新读取，随后由保存前检查处理冲突。
- MVU 自己保存触发的 `WORLDINFO_UPDATED` 不会打断当前自动保存流程。
- 没有生效的角色卡配置时标题显示“未启用”。
- 任一普通覆盖字段生效时标题显示“覆盖中”。
- 普通覆盖值与用户值相同时仍显示“覆盖中”和对应覆盖标识。
- 只有角色卡白名单或黑名单生效时标题也显示“覆盖中”。
- JSON 或配置校验失败时标题显示“未启用”。
- 没有 `character_worldbook` 时组件整体禁用且不能创建配置条目。
- 有 `character_worldbook`、没有 `[config_override]` 时可以编辑，首次修改自动创建关闭条目。
- 草稿最终为空时自动保存仅含 `schema` 的关闭条目，标题保持“未启用”。
- 清除最后一个实际配置字段时保留 schema-only 条目，不删除世界书条目。
- 新建条目的 comment、关闭状态和 JSON 内容正确。
- 已有 `[config_override]` 时自动保存更新扫描到的第一个条目。
- 自动保存后更新预期 `content`，并在没有更新版本草稿时重新加载角色卡配置和最终生效值。
- 保存前原条目 `content` 符合预期时直接写入。
- 保存前原条目被修改、删除，或 `content` 不符合预期时弹出覆盖确认。
- 原本没有条目、自动保存前外部新增了条目时弹出覆盖确认。
- 用户确认冲突覆盖后写入当前 UI 草稿，并更新预期 `content`。
- 用户拒绝覆盖或关闭弹窗后放弃当前 UI 草稿，重新加载外部最新配置。
- 普通字段选择“跟随用户配置”后不会写入 JSON。
- 白名单和黑名单留空时不会写入对应角色卡规则。
- 普通字段存在时角色卡值覆盖用户值；字段缺失时继承用户值。
- 只有约定的 6 个配置字段参与运行时行为，未知字段 loose/passthrough 并在保存后保留。
- 合法 JSON、非法 JSON、字段类型错误。
- 缺少 `schema` 时配置仍能加载，下一次自动保存补齐 schema。
- 由 MVU 创建或保存的 JSON 始终包含 `schema`，并将它排列在最后。
- 任意检查失败时将角色卡配置视为不存在、发出 toastr，并保留原条目标识和预期 `content`。
- 无效 JSON 在 UI 中按空配置展示，用户修改表单并通过自动保存乐观检查后可以覆盖修复原条目。
- 示例和自动生成的 JSON 始终将 `schema` 排列在最后。
- 能从关闭状态的 `[config_override]` 条目加载配置。
- `[config_override]` 标记大小写不敏感。
- `[config_override]` comment 去除首尾空白后必须精确匹配。
- `character_worldbook` 中存在多个 `[config_override]` 时，只处理扫描到的第一个并发出 toastr 警告。
- 重复的后续条目不会参与解析或配置合并。
- 只有用户白名单、只有角色卡白名单、两者同时存在。
- 白名单匹配任意一个来源即可保留。
- 只有用户黑名单、只有角色卡黑名单、两者同时存在。
- 黑名单匹配任意一个来源即排除。
- 同一个条目同时匹配两个黑名单时记录两个来源。
- 同一个条目未匹配两个白名单时记录两个来源。
- 用户正则有效但角色卡正则无效，以及反向场景。
- `[mvu_update]` 条目继续绕过白名单和黑名单。
- 关闭状态的 `[config_override]` 条目不会进入模型请求。
- 切换角色卡或聊天后重新加载，旧角色卡配置不会残留。
- 筛选结果弹窗和日志正确展示配置来源。
- 被角色卡覆盖的现有全局设置显示“角色卡覆盖”标识。
- 白名单和黑名单显示“角色卡规则叠加”而不是“角色卡覆盖”。

## 实现范围

- 多人聊天不额外选择某一角色卡配置；无法取得当前角色的主世界书时按“未绑定”处理，不应用角色卡覆盖。
