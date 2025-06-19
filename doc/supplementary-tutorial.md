# MVU 新功能补充教程

本文档是为已经熟悉 MVU 基础用法的用户准备的，旨在帮助你快速了解和掌握本次更新带来的**一系列强大的新功能**。原有的教程依然完全适用，这里只讲解新增和被增强的部分。

本次更新的核心目标是：**赋予你（和LLM）更强大、更灵活、更直观的变量操作能力，同时保证整个过程的绝对安全。**

## 1. 新增的变量操作命令

除了熟悉的 `_.set`，现在新增了三个语义更明确的命令，让AI能更清晰地表达它的意图。

### `_.modify` - 方便地修改布尔值和数值

这是最推荐的“状态变更”命令，专门用于修改布尔值和数值。让LLM在set命令中自己动脑子计算一遍旧值和新值比较容易出错，有些时候它根本不会遵循描述中写的变化范围（当然谷圣新模型的智力基本上都上来了，不过还是推荐这样做）。

*   **布尔值切换（一个参数）**：
    ```
    // 如果 is_raining 是 true，它会变成 false，反之亦然
    _.modify('is_raining');
    ```
    这比写 `_.set('is_raining', true, false);` 简单多了。

*   **数值增减（两个参数）**：
    ```
    // gold 增加 10
    _.modify('gold', 10);

    // health 减少 5
    _.modify('health', -5);
    ```
    AI不再需要自己构建 `_.set('gold', 10, 12);` 这样的表达式，大大降低了出错的风险。

### `_.assign` - 插入元素

这个命令用于向数组或对象里添加新东西。

*   **向数组添加元素**：
    ```
    // 在'inventory'数组末尾添加'新获得的钥匙'
    _.assign('inventory', '新获得的钥匙');

    // 在'inventory'数组的第 0 个位置插入'古老的卷轴'
    _.assign('inventory', 0, '古老的卷轴');
    ```

*   **向对象添加键值对**：
    ```
    // 在'achievements'对象中添加一个新的成就
    _.assign('achievements', 'FIRST_MEETING', '与悠纪的初次相遇');
    ```

### `_.remove` - 删除元素

*   **删除整个变量**：
    ```
    // 删除一个临时的任务标记
    _.remove('temp_quest_marker');
    ```

*   **从数组中删除**：
    ```
    // 从'inventory'数组中删除'用掉的药水'这个物品
    _.remove('inventory', '用掉的药水');

    // 从'inventory'数组中删除索引为 2 的物品
    _.remove('inventory', 2);
    ```

*   **从对象中删除**：
    ```
    // 按键名删除
    _.remove('achievements', 'FIRST_MEETING');

    // 按数字索引删除
    // 如果'achievements'是{"a":1, "b":2, "c":3}，下面这行会删除'"b":2'
    _.remove('achievements', 1);
    ```

## 2. 数据结构安全：用 `"$meta"` 和 `"$__META_EXTENSIBLE__$"` 规则保护你的变量

LLM可能会误用 `assign` 或 `remove` 命令，破坏你精心设计的数据结构（例如，给角色属性添加一个不存在的字段，或者在角色死亡时发癫将整个角色删除）。为了解决这个问题，现在引入了**模式保护机制**。

你可以在 `[InitVar]` 的JSON文件中，通过添加一个特殊的 `"$meta"` 键来定义规则，告诉系统哪些部分是固定的，哪些是可变的。
对于数组，你可以通过在其中任意位置添加一个 `"$__META_EXTENSIBLE__$"` 字符串来定义它的结构可变，如果不填，默认是不可变的。

### 如何使用 `"$meta"`

`"$meta"` 对象目前只接受一个属性：`"extensible"` (可扩展的)。
*   `"extensible": false` (默认，你可以不写，如果你不写出来的话就默认是这个值)：意味着这个对象是**锁定的**。LLM不能向其添加新的键，也不能删除已有的键。
*   `"extensible": true`：意味着这个对象是**开放的**。LLM可以用 `_.assign` 添加新键，或用 `_.remove` 删除键。
*   这个键在初始化完成后会被移除，不会出现在后续的 `stat_data` 里面，所以不用担心它占用token和模型注意力。

**示例：保护角色属性，同时开放飞机清单**

```json
{
  "$meta": { "extensible": false }, // 锁定顶层结构，不能添加新角色
  "福建": {
    "$meta": { "extensible": false }, // 锁定“福建”的核心属性
    "舰船状态": ["停泊", "描述..."],
    "舰载机": [{
      "$meta": { "extensible": false }, // 锁定“舰载机”的状态分类
      "已升空": { "$meta": { "extensible": true } }, // 开放“已升空”列表，允许增删飞机
      "可部署": { "$meta": { "extensible": true } }, // 开放“可部署”列表
      "补给中": { "$meta": { "extensible": true } }  // 开放“补给中”列表
    }, "描述..."]
  }
}
```

### 如何使用 `"$__META_EXTENSIBLE__$"`

如果你要定义一个数组为可扩展，你只需要在里面放一个 `"$__META_EXTENSIBLE__$"` 就可以了，在世界书初始化完成后，它也会被移除，不用担心它占用token和模型注意力。
默认情况下所有数组的结构也都是锁定的，只有你往里面放了这个字符串，它的结构才可变。

**示例：开放“着装”数组，使得着装列表可以增删**

```json
{
  "<user>": {
    "着装": [[
      "衬衫",
      "短裤",
      "$__META_EXTENSIBLE__$"
    ], "描述..."]
  }
}
```

通过这种规则，你可以精确控制数据结构的每一部分，既保证了核心数据的安全，又赋予了必要部分的灵活性。

## 3. 数学运算

现在脚本中有 `math.js` 库。这意味着现在可以安全地执行复杂的计算，这个功能在遇到某些LLM更新变量时飙出一句表达式的时候很有用。

```
// 以前这种操作会让变量直接爆炸，数值变量变成一个字符串变量可不算什么好玩的事情。但现在可以这样玩了
_.set('悠纪.好感度', 10, 10 + 2);

// 也可以写一些更复杂的表达式，比如指对幂、三角函数甚至微积分
_.set('悠纪.好感度', 10, math.pow(2, 3) + math.sin(math.PI));
_.set('悠纪.好感度', 10, math.integrate('x^2', 'x', 0, 1));

// 其实甚至支持复数和矩阵运算
_.set('悠纪.好感度', 10, math.complex(2, 3).add(math.complex(1, -1)));
_.set('悠纪.好感度', 10, math.matrix([[1, 2], [3, 4]]).multiply(math.matrix([[5], [6]])));

// 当然这些只是示例，你没必要要求LLM使用这么复杂的数学表达式，除非你真的需要它来计算某些复杂的数值
```

你不需要担心它将任何长得像数学表达式的东西都做一遍数学运算，比如日期"2000-01-01"这种，如果输入参数中带引号，它会被判别为字符串，会按照字符串类型写进变量中。

```
// 这种带引号的写法是不会被判定成数学表达式的
_.set('当前日期', '2000-01-01');
```

## 4. 如何正确操作 `[值, 描述]` 结构

为了保证数据安全和描述信息不丢失，现在对如何操作带有描述的变量（即 `["值", "描述"]` 这种形式）提出了明确的规范。

**核心规则：当要操作的值本身是一个对象或数组时，必须在路径中使用 `[0]` 来明确指定要操作的是“值”本身。**

#### 示例：操作“舰载机”

假设有这样一个嵌套结构：

```json
{
	"stat_data": {
		"福建": {
			"舰载机": [{
				"补给中": {
					"J-35": 8
				},
                "可部署": {
                    "J-35": 8
                }
			}, "描述文本"]
		}
	}
}
```

-   **正确 ✅**
    ```
    // 精准定位到舰载机的数据对象 [0]，然后修改其内部的值
    _.set('福建.舰载机[0].补给中.J-35', 8, 9);

    // 精准定位到“可部署”列表，然后插入新飞机
    _.assign('福建.舰载机[0].可部署', 'J-15T', 12);
    ```
-   **错误 ❌**
    ```
    // 这个路径是无效的，变量不会有任何变化
    _.set('福建.舰载机.补给中.J-35', 8, 9);

    // 而这个操作因为尝试污染数据结构，会被屏蔽掉
    _.assign('福建.舰载机.补给中', 'J-15T', 8);
    ```

#### 便利的快捷方式（仅限简单值）

为了保证对老卡的兼容性，当使用 `_.set` 或 `_.modify` 操作**简单值**（字符串、数字、布尔值）时，可以省略 `[0]`，脚本能正确处理。但这只是为了兼容老卡的写法，并不推荐在新卡中使用这种方式。

```
// 这两种写法现在都能安全工作
_.set('经历天数', 1);
_.set('经历天数[0]', 1);
```

虽然有快捷方式，但我依然强烈建议，**在编写提示词引导LLM时，要求它始终使用带 `[0]` 的精确路径**。这是一种更严谨、更不会出错的方法。特别地，当你的卡涉及到增删操作时，请务必让LLM填写精确路径，因为assign和remove是不支持快捷输入的。

## 5. 推荐的提示词（LLM操作指南）

为了让LLM更好地理解并使用上述新功能，我提供了一份推荐的提示词模板。你可以将它整合到你的世界书或角色卡设定中，换掉原来那份模板。这份提示词明确地告知了LLM所有可用的命令以及最重要的 `[0]` 规则。

```ejs
<%_ setvar('initialized_lorebooks.-SnowYuki[0]', true); _%>
{{//这个值是用来判别世界书是否初始化的，在世界书加载一次之后就永久为true，可以在某些变量需要屏蔽来自LLM的更新时使用，避免将初始化设置也屏蔽掉}}
【变量更新】
最后，进行变量更新。
以下是故事中需要追踪的关键变量，当前状态以这些变量的值为准。
<status_current_variables>
{{get_message_variable::stat_data}}
</status_current_variables>
严格按照以下规则和格式进行输出，并确定每一个变量是否需要更新，不要遗漏：
rule:
  description: You should output the update analysis in the end of the next response, following the variables list defined in <status_current_variables> section which will be provided by the previous turn.
  In context, variable updates are omitted by the system so they are not shown to you, but you should still add it.
  analysis:
    - You must rethink what variables are defined in the previous <status_current_variables> property, and analyze how to update each of them accordingly.
    - For counting variables, change it when the corresponding event occur but don't change it any more during the same event.
    - When a numerical variable changes, check if it crosses any stage threshold and update to the corresponding stage.
    - It is allowed to use math expressions for number inputs.
    - If dest element is in an array with description, **PRECISELY** locate the element by adding "[0]" suffix. DO NOT modify the description.
    - There are 4 commands can be used to modify the data: `_.set`, `_.assign`, `_.remove` and `_.modify`.
    - to set a certain value, use `_.set`, it supports 2 or 3 input args.
    - to insert something into an array or object, use `_.assign`, it supports 2 or 3 input args.
    - to delete something from an object/array, use `_.remove`, it supports 1 or 2 input args.
    - If you need to assign or remove multiple values, use `_.assign` or `_.remove` multiple times, not in a single command.
    - to change a boolean status or to add a delta to a number, use `_.modify`, it supports 1 or 2 input args, and only supports modifications to number or boolean variables.
  format: |-
    <UpdateVariable>
        <Analysis>$(IN ENGLISH$)
            - calculate time passed: ...
            - decide whether dramatic updates are allowed as it's in a special case or the time passed is more than usual: yes or no
            - list every variable in `<status_current_variables>` section...
            - Check the description of this variable and analyze whether it satisfies its change conditions, do not output reason:...
            - Ignore summary related content when evaluate.
            ...
        </Analysis>
        _.set('${path}', ${old}?, ${new});//${reason}
        _.assign('${path}', ${key_or_index}?, ${value});//${reason}
        _.remove('${path}', ${key_or_index_or_value}?);//${reason}
        _.modify('${path}', ${delta}?);//${reason}
    </UpdateVariable>
  example: |-
    <UpdateVariable>
        <Analysis>
            当前时间[0]: Y
            悠纪.好感度[0]: Y
            悠纪.重要成就[0]: Y
            悠纪.着装[0]: Y
            ...
        </Analysis>
        _.set('当前时间[0]', '2026-6-1 10:05', '2026-6-1 10:15');//时间流逝
        _.modify('悠纪.好感度[0]', 2);//与悠纪的好感度增加
        _.assign('悠纪.重要成就[0]', '2026年6月1日，悠纪对<user>告白成功');//悠纪对<user>成功告白
        _.remove('悠纪.着装[0]', '粉色缎带');//悠纪脱下粉色缎带
    </UpdateVariable>
```
