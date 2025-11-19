# MVU Beta 使用教程

本文档是为已经熟悉 MVU 基础用法的用户准备的，旨在帮助你快速了解和掌握 MVU Beta 带来的**一系列强大的新功能**。原有的 MVU 基础教程依然完全适用，这里只讲解新增和被增强的部分。

本次更新的核心目标是：**赋予你（和LLM）更强大、更灵活、更直观的变量操作能力，同时保证整个过程的绝对安全。**

如果你需要一张示例卡，可以参考[此仓库](https://gitgud.io/KazePsi/file-storage/-/tree/master/Reina/Card)中的内容，或者直接来[这里](https://discord.com/channels/1134557553011998840/1392106810374225921)。

## 1. 新增的变量操作命令

除了熟悉的 `_.set`，现在新增了三个语义更明确的命令，让AI能更清晰地表达它的意图。

### `_.add` - 方便地修改数值

这是最推荐的“数值变更”命令。让LLM在set命令中自己动脑子计算一遍旧值和新值比较容易出错，有些时候它根本不会遵循描述中写的变化范围（当然谷圣新模型的智力基本上都上来了，不过还是推荐这样做）。

*   **数值增减（两个参数）**：
    ```
    // gold 增加 10
    _.add('gold', 10);

    // health 减少 5
    _.add('health', -5);
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

## 2. 数据结构安全：引入模式校验，并用 `"$meta"` 和 `"$__META_EXTENSIBLE__$"` 规则保护你的变量

LLM可能会误用 `assign` 或 `remove` 命令，破坏你精心设计的数据结构（例如，给角色属性添加一个不存在的字段，或者在角色死亡时发癫将整个角色删除）。为了解决这个问题，现在引入了**模式校验保护机制**。

你可以在 `[InitVar]` 的JSON文件中，通过添加一个特殊的 `"$meta"` 键来定义对象规则，告诉系统哪些部分是固定的，哪些是可变的。
对于数组，你可以通过在其中任意位置添加一个 `"$__META_EXTENSIBLE__$"` 字符串来定义它的结构可变，如果不填，默认是不可变的。
在世界书初始化及每一次结构变动后，都会为当前的 `stat_data` 生成一个模式，在LLM执行增删命令时将会执行模式校验，防止其进行未授权的结构变动。

### 如何使用 `"$meta"` 和 `"$__META_EXTENSIBLE__$"`

`"$meta"` 对象目前接受四个属性：`"extensible"`(可扩展的)、`"required"`(必需的)、`"recursiveExtensible"`(递归扩展)、`"template"`(模板)。这几个属性可以帮助你控制数据结构的灵活性和安全性。
*   `"extensible": false` (默认)：意味着这个对象是**锁定的**。LLM不能向其添加新的键，也不能删除已有的键。
*   `"extensible": true`：意味着这个对象是**开放的**。LLM可以用 `_.assign` 添加新键，或用 `_.remove` 删除键。这同时会导致该层下的所有子元素的required属性都被设置为 `false`，除非你在required数组中另行指定。
*   `"required": []`：一个数组，在其中填入需要被保护的子对象的键名，表示这个对象是**必需的**。不允许被 `_.remove` 删除，如果不写这个数组，那所有子对象是否必需则根据extensible而定。
*   `"recursiveExtensible"`：如果设置为 `true`，则表示这个对象的所有子孙对象都为可扩展，这是穿透性的，除非被一个特别设置的 `"extensible": false` 截断才会停止向下递归，默认为 `false`。在当前层，`"recursiveExtensible": true` 等效于 `"extensible": true`。
*   `"template"`：可以是对象或数组，表示这个结构的结构模板。LLM在使用 `_.assign` 添加新结构时会自动合并这个模板来生成新的子结构，默认为空。
*   你可以偷懒，整个 `"$meta"` 键都可以不写，系统会采用默认值。
*   这个键在初始化完成后会被移除，不会出现在后续的 `stat_data` 里面，所以不用担心它占用token和模型注意力。
*   如果你要定义一个数组为可扩展，你只需要在里面放一个 `"$__META_EXTENSIBLE__$"` 就可以了，在世界书初始化完成后，它也会被移除，不用担心它占用token和模型注意力。
*   默认情况下所有数组的结构也都是锁定的，只有你往里面放了这个字符串，它的结构才可变。

**示例：保护角色属性，同时开放舰船武备和飞机清单**

```json5
{
  "$meta": { "extensible": false }, // 锁定顶层结构，不能添加新元素。这个可以不写，默认就是false
  "福建": {
    "舰船状态": ["航行", "舰船状态变化时更新。"],
    "舰船武备": [["$__META_EXTENSIBLE__$", "海红旗10防空导弹", "1130近防炮"], "舰船武备变化时更新。"], //令武备列表中可以增删内容
    "舰载机": [{
	  "已升空": {"$meta": {"extensible": true}}, // 开放“已升空”、“可部署”和“补给中”对象，允许增删飞机以及其相应状态
	  "可部署": {"$meta": {"extensible": true}, "歼-35隐身战斗机": 6, "歼-15T多用途战斗机": 6, "攻击-11隐身无人机": 6, "空警-600预警机": 1, "歼-15D电子战机": 2, "直-20S直升机": 2},
	  "补给中": {"$meta": {"extensible": true},"歼-35隐身战斗机": 6, "歼-15T多用途战斗机": 6, "攻击-11隐身无人机": 10, "空警-600预警机": 2, "歼-15D电子战机": 2, "直-20S直升机": 4}
	}, "舰载机状态变化或换装新装备时更新，可以增删其中的键，某状态数量为0时直接删除"]
  }
}
```

在读取这个世界书后，stat_data会变成这个样子：

```json5
{
    福建: {
        舰船状态: [
            "航行",
            "舰船状态变化时更新。"
        ],
        舰船武备: [
            [
                "海红旗10防空导弹",
                "1130近防炮"
            ],
            "舰船武备变化时更新。"
        ],
        舰载机: [
            {
                已升空: {

                },
                可部署: {
                    歼-35隐身战斗机: 6,
                    歼-15T多用途战斗机: 6,
                    攻击-11隐身无人机: 6,
                    空警-600预警机: 1,
                    歼-15D电子战机: 2,
                    直-20S直升机: 2
                },
                补给中: {
                    歼-35隐身战斗机: 6,
                    歼-15T多用途战斗机: 6,
                    攻击-11隐身无人机: 10,
                    空警-600预警机: 2,
                    歼-15D电子战机: 2,
                    直-20S直升机: 4
                }
            },
            "舰载机状态变化或换装新装备时更新，可以增删其中的键，某状态数量为0时直接删除"
        ]
    }
}
```

你会发现其中的 `$meta` 和  `"$__META_EXTENSIBLE__$"` 都不见了，这样在之后玩卡的时候就不会将这些发送给LLM。
但其实背后生成了这样一个模式：

```json
{
    "type": "object",
    "properties": {
        "福建": {
            "type": "object",
            "properties": {
                "舰船状态": {
                    "type": "array",
                    "extensible": false,
                    "elementType": {
                        "type": "string"
                    },
                    "required": true
                },
                "舰船武备": {
                    "type": "array",
                    "extensible": false,
                    "elementType": {
                        "type": "array",
                        "extensible": true,
                        "elementType": {
                            "type": "string"
                        }
                    },
                    "required": true
                },
                "舰载机": {
                    "type": "array",
                    "extensible": false,
                    "elementType": {
                        "type": "object",
                        "properties": {
                            "已升空": {
                                "type": "object",
                                "properties": {},
                                "extensible": true,
                                "required": true
                            },
                            "可部署": {
                                "type": "object",
                                "properties": {
                                    "歼-35隐身战斗机": {
                                        "type": "number",
                                        "required": false
                                    },
                                    "歼-15T多用途战斗机": {
                                        "type": "number",
                                        "required": false
                                    },
                                    "攻击-11隐身无人机": {
                                        "type": "number",
                                        "required": false
                                    },
                                    "空警-600预警机": {
                                        "type": "number",
                                        "required": false
                                    },
                                    "歼-15D电子战机": {
                                        "type": "number",
                                        "required": false
                                    },
                                    "直-20S直升机": {
                                        "type": "number",
                                        "required": false
                                    }
                                },
                                "extensible": true,
                                "required": true
                            },
                            "补给中": {
                                "type": "object",
                                "properties": {
                                    "歼-35隐身战斗机": {
                                        "type": "number",
                                        "required": false
                                    },
                                    "歼-15T多用途战斗机": {
                                        "type": "number",
                                        "required": false
                                    },
                                    "攻击-11隐身无人机": {
                                        "type": "number",
                                        "required": false
                                    },
                                    "空警-600预警机": {
                                        "type": "number",
                                        "required": false
                                    },
                                    "歼-15D电子战机": {
                                        "type": "number",
                                        "required": false
                                    },
                                    "直-20S直升机": {
                                        "type": "number",
                                        "required": false
                                    }
                                },
                                "extensible": true,
                                "required": true
                            }
                        },
                        "extensible": false
                    },
                    "required": true
                }
            },
            "extensible": false,
            "required": true
        }
    },
    "extensible": false
}
```

可以看到，需要扩展的部分被正确地设置了extensible，同时，设置了extensible的三种舰载机状态中已经有的飞机也被设置了required: false，这意味着这些元素不是锁死的，LLM未来可以删除它们。
此时LLM输入这些指令是合法的，因为它们处于extensible的结构下，且required === false：

```javascript
_.assign('福建.舰载机[0].已升空', '空警-600预警机', 1);//起飞一架空警-600
_.remove('福建.舰载机[0].可部署', '空警-600预警机');//所有待部署的空警-600已起飞，删除此键
```

但输入这些指令是非法的，会被屏蔽：

```javascript
_.assign('福建.舰载机[0]', {"维修中": {}});//添加“维修中”状态
_.remove('福建.舰载机[0].可部署');//删除“可部署”状态
```

**示例：在根节点添加新角色**

要注意的是，如果父节点被设置了extensible，那么那一层就允许增删子元素，如果你需要规定某个元素不可删除，就必须在required数组中特别设置受保护的对象的键名

```json5
{
  "$meta": { "extensible": true, "required": ["甲", "乙"] }, // 现在顶层结构是开放的，允许添加新角色，同时特别规定甲和乙不可删除
  "甲": {
    "状态A": [0, "描述..."],
    "状态B": [0, "描述..."]
  },
  "乙": {
    "状态A": [0, "描述..."],
    "状态B": [0, "描述..."]
  },
  "丙": {    // 丙没有被填入required数组，所以丙可以被删除
    "状态A": [0, "描述..."],
    "状态B": [0, "描述..."]
  }
}
```

### 复杂情况

如果你需要允许在根节点添加新角色，但你的角色变量中包含可变结构，那你需要提示LLM在添加新角色时，在对应的可变结构中设置 `"$meta"` 或者 `"$__META_EXTENSIBLE__$"`。

比如你的角色变量中有一个“着装”数组，你希望它可以增删，但同时你又希望顶层结构是开放的，允许添加新角色。那你就需要在用例中这样提示LLM：

```javascript
_.assign('', '新角色', {
  "好感度": [0, "描述"],
  "着装": [[
    "衬衫",
    "短裤",
    "或者其他你想设置的着装",
    "$__META_EXTENSIBLE__$"
  ], "描述..."]
});
```

这有点麻烦，因为根路径上并没有描述文本，所以你需要改一下下面的用例，提示LLM可以添加角色，并用空字符串 `''` 作为路径。

通过这种规则，你可以精确控制数据结构的每一部分，既保证了核心数据的安全，又赋予了必要部分的灵活性。

### 递归扩展

如果你需要一个对象的所有子孙对象都可以扩展，你可以在 `$meta` 中设置 `"recursiveExtensible": true`。这会使得这个对象的所有子孙对象都继承这个可扩展性。
以下示例是一个类Unix文件系统的目录树，在根目录设置一个 `"recursiveExtensible": true`，就可以使得这个高度自由的目录树完全不受schema约束。

```json5
{
    "/": {
        "$meta": {
            "recursiveExtensible": true
        },
        "home": {
            "alice": {
                "notes.txt": "document",
                "photos": {}
            }
        },
        "etc": {
            "passwd": "file"
        },
        "var": {}
    }
}
```

### 模板

如果你需要在添加新元素时自动填充一些默认值，可以在 `$meta` 中设置 `"template"`。这会在使用 `_.assign` 添加新元素时，将模板中的内容合并到新元素中。
依然拿上面的类Unix文件系统目录树为例，如果你希望每个新添加的用户目录都包含一个默认的 `notes.txt` 文件和一个空的 `photos` 目录，你可以这样设置：

```json5
{
    "/": {
        "$meta": {
            "recursiveExtensible": true
        },
        "home": {
            "$meta": {
                "template": {
                    "notes.txt": "document",
                    "photos": {}
                }
            },
            "alice": {
                "notes.txt": "document",
                "photos": {}
            }
        },
        "etc": {
            "passwd": "file"
        },
        "var": {}
    }
}
```

这样，当使用 `_.assign('/.home', 'bob', {})` 添加新用户时，`bob` 的目录会自动包含 `notes.txt` 和 `photos`。

特殊的，如果你需要在数组中使用 template，可以在数组中写入一个包含 `$meta` 和 `$arrayMeta: true` 的 json 对象，这样这个对象里的信息会被识别为这个数组的 meta 信息，如：
```json
{
    "记忆": [
        {
            "$meta": {
                "template": ["重要的记忆"]
            },
            "$arrayMeta": true
        }
    ]
}
```
在使用语句 `_.assign('记忆', ["成为了猫娘"]);` 时，结果为
```json
{
    "记忆": [
        ["成为了猫娘", "重要的记忆"]
    ]
}
```

template可以为对象，也可以为数组。如果是数组，则会将数组模板与新加入的数组合并。

```
{
    "道具": {
        "$meta": {
            "extensible": true,
            "template": [
                "ルビーちゃん", "何が好き", "チョコミント"
            ]
        }
    }
}
```
在这个用例下，如果进行了这种输入：
`_.assign('道具', '万用表', ["ゆちゃん"]);`
那么结果就会是：
```json
{
    "道具": {
        "万用表": [
            "ゆちゃん", "ルビーちゃん", "何が好き", "チョコミント"
        ]
    }
}
```

#### 全局开关
模板的部分特性支持全局改变行为：
```json
{
    "$meta" : {
        "strictTemplate": false,
        "concatTemplateArray": true
    }
}
```
在根级别的 `$meta` 信息上设置即可调整。

下面的这两种行为都是面向数组情况的，因此以下面的变量结构为例子：
```json
{
    "道具": {
        "$meta": {
            "extensible": true,
            "template": [
                {"name": "ルビーちゃん"}, "何が好き", "チョコミント"
            ]
        }
    }
}
```
##### strictTemplate(默认关闭)
是否允许语句中 `字面值` 隐式转换到 `[字面值]`。如下面的语句:
```js
_.assign('道具','万用表', 'abc');
```
在关闭时结果为(concatTemplateArray: true):
```json
{
    "道具": {
        "万用表": [
            "abc", {"name": "ルビーちゃん"}, "何が好き", "チョコミント"
        ]
    }
}
```
在开启时结果为:
```json
{
    "道具": {
        "万用表": "abc"
    }
}
```
在不隐式转换时，因为类型不符，直接不应用模板。
##### concatTemplateArray(默认开启)
明确在进行数组的合并操作时，实际的行为逻辑是 拼接，还是融合。如下面的语句:
```js
_.assign('道具', '万用表', [{"name": "ruby"}]);
```
在开启时结果为:
```json
{
    "道具": {
        "万用表": [
            {"name": "ruby"}, {"name": "ルビーちゃん"}, "何が好き", "チョコミント"
        ]
    }
}
```
在关闭时结果为:
```json
{
    "道具": {
        "万用表": [
            {"name": "ruby"}, "何が好き", "チョコミント"
        ]
    }
}
```


关于template的具体行为，可以参考以下表格：
<details>
<summary>template行为表</summary>
| 对象类型 | template类型            | assign版本 | 待插入入参类型 | 具体覆盖行为                       |
  |------|-----------------------|----------|---------|------------------------------|
  | 数组   | 对象 (StatData)         | 2参数      | 对象      | 合并模板与入参对象，入参优先               |
  | 数组   | 对象 (StatData)         | 2参数      | 数组      | 直接插入数组，无模板应用             |
  | 数组   | 对象 (StatData)         | 2参数      | 字面量     | 将字面量直接插入，不应用模板               |
  | 数组   | 数组 (StatData[]/any[]) | 2参数      | 对象      | 直接插入对象，无模板应用             |
  | 数组   | 数组 (StatData[]/any[]) | 2参数      | 数组      | (concatTemplateArray)创建新数组，并合并模板与入参数组                  |
  | 数组   | 数组 (StatData[]/any[]) | 2参数      | 字面量     | (strictTemplate)直接插入，无模板应用         |
  | 数组   | 无                     | 2参数      | 任意      | 直接插入，无模板应用                   |
  | 对象   | 任意                    | 2参数      | 对象      | 不应用模板（无法确定新增元素）              |
  | 对象   | 任意                    | 2参数      | 非对象     | 报错，不支持合并                     |
  | 数组   | 对象 (StatData)         | 3参数      | 对象      | 合并模板与入参对象，入参优先               |
  | 数组   | 对象 (StatData)         | 3参数      | 数组      | 直接在指定位置插入数组，无模板应用             |
  | 数组   | 对象 (StatData)         | 3参数      | 字面量     | 将字面量直接插入指定位置，不应用模板           |
  | 数组   | 数组 (StatData[]/any[]) | 3参数      | 对象      | 直接在指定位置插入对象，无模板应用             |
  | 数组   | 数组 (StatData[]/any[]) | 3参数      | 数组      | (concatTemplateArray)在指定key创建新数组，并合并模板与入参数组                  |
  | 数组   | 数组 (StatData[]/any[]) | 3参数      | 字面量     | (strictTemplate)直接在指定位置插入，无模板应用       |
  | 数组   | 无                     | 3参数      | 任意      | 直接在指定位置插入，无模板应用              |
  | 对象   | 对象 (StatData)         | 3参数      | 对象      | 合并模板与入参对象，设置到指定key           |
  | 对象   | 对象 (StatData)         | 3参数      | 数组      | 将数组直接设置到指定key，不应用模板             |
  | 对象   | 对象 (StatData)         | 3参数      | 字面量     | 将字面量直接设置到指定key，不应用模板         |
  | 对象   | 数组 (StatData[]/any[]) | 3参数      | 对象      | 将对象直接设置到指定key，不应用模板             |
  | 对象   | 数组 (StatData[]/any[]) | 3参数      | 数组      | (concatTemplateArray)合并模板与入参数组，设置到指定key           |
  | 对象   | 数组 (StatData[]/any[]) | 3参数      | 字面量     | (strictTemplate)将字面量直接设置到指定key，不应用模板 |
  | 对象   | 无                     | 3参数      | 任意      | 直接设置到指定key，无模板应用             |
</details>

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

为了保证对老卡的兼容性，当使用 `_.set` 或 `_.add` 操作**简单值**（字符串、数字、布尔值）时，可以省略 `[0]`，脚本能正确处理。但这只是为了兼容老卡的写法，并不推荐在新卡中使用这种方式。

```
// 这两种写法现在都能安全工作
_.set('经历天数', 1);
_.set('经历天数[0]', 1);
```

虽然有快捷方式，但我依然强烈建议，**在编写提示词引导LLM时，要求它始终使用带 `[0]` 的精确路径**。这是一种更严谨、更不会出错的方法。特别地，当你的卡涉及到增删操作时，请务必让LLM填写精确路径，因为assign和remove是不支持快捷输入的。

## 5. 推荐的提示词（LLM操作指南）

为了让LLM更好地理解并使用上述新功能，我提供了一份推荐的提示词模板。你可以将它整合到你的世界书或角色卡设定中，换掉原来那份模板。这份提示词明确地告知了LLM所有可用的命令以及最重要的 `[0]` 规则。

```ejs
<%_ setLocalVar('initialized_lorebooks.-SnowYuki[0]', true); _%>
{{// 这个值是用来判别世界书是否初始化的，在世界书加载一次之后就永久为true，可以在某些变量需要屏蔽来自LLM的更新时使用，避免将初始化设置也屏蔽掉}}
{{// 不要使用setvar，会插入到用户消息变量中导致消息swipe出错}}
**变量更新**
在所有文本的最后，进行变量更新。
以下是故事中需要追踪的关键变量，当前状态以这些变量的值为准。
<status_current_variables>
{{get_message_variable::stat_data}}
</status_current_variables>
严格按照以下规则和格式进行输出，并确定每一个变量是否需要更新，不要遗漏：
rule:
  description:
    - You should output the update analysis in the end of the next response, following the variables list defined in <status_current_variables> section which will be provided by the previous turn.
    - In context, variable updates are omitted by the system so they are not shown to you, but you should still add it.
    - There are 4 commands can be used to adjust the data.
    - _.set: Used to set a certain simple value (strings, numbers, booleans). It only supports 2 input args, and it doesn't support arrays or objects as inputs.
      _.assign: Used to insert something into an array or object. It supports 2 or 3 input args.
      _.remove: Used to delete something from an array or object. It supports 1 or 2 input args.
      _.add: Used to add a delta to a number. It only supports 2 input args, and only supports modifications to numbers.
    - If you need to assign or remove multiple values, use `_.assign` or `_.remove` multiple times, not in a single command.
  analysis:
    - You must rethink what variables are defined in the previous <status_current_variables> property, and analyze how to update each of them accordingly.
    - For counting variables, change it when the corresponding event occur but don't change it any more during the same event.
    - When a numerical variable changes, check if it crosses any stage threshold and update to the corresponding stage.
    - If dest element is in an array with description, **PRECISELY** locate the element by adding "[0]" suffix. DO NOT change the description.
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
        _.add('${path}', ${delta});//${reason}
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
        _.add('悠纪.好感度[0]', 2);//与悠纪的好感度增加
        _.assign('悠纪.重要成就[0]', '2026年6月1日，悠纪对<user>告白成功');//悠纪对<user>成功告白
        _.remove('悠纪.着装[0]', '粉色缎带');//悠纪脱下粉色缎带
    </UpdateVariable>
```
另外，如果你打算让LLM采用JSON Patch形式的变量更新模式，则请使用这个规则：
```yaml
rule:
  description:
    - You should output the update analysis in the end of the next response, following the variables list.
    - The update command must strictly follow the **JSON Patch (RFC 6902)** standard.
    - The output must be a valid JSON array containing operation objects.
  analysis:
    - You must rethink what variables are defined, and analyze how to update each of them accordingly.
    - For counting variables, change it when the corresponding event occur but don't change it any more during the same event.
  format: |-
    <UpdateVariable>
        <Analysis>$(IN ENGLISH$)
            - calculate time passed: ...
            - list every variable node that acts as a candidate for update...
            - [Numerical Calculation]: Old Value (X) + Delta (Y) = New Value (Z). (Use 'replace')
            - [Array Modification]: Identify index to remove (e.g., 0 for first item) or use `/-` to append.
            - [Object Modification]: Check if key exists. New key = 'add', Existing key = 'replace'.
            ...
        </Analysis>
        <JSONPatch>
    [
      { "op": "replace", "path": "/path/to/variable", "value": "new_value" },
      { "op": "move", "from": "/source/list/0", "path": "/dest/list/-" },
      { "op": "add", "path": "/path/to/array/-", "value": "item_to_append" },
      { "op": "remove", "path": "/path/to/array/0" },
      { "op": "add", "path": "/path/to/object/newKey", "value": "content" }
    ]
        </JSONPatch>
    </UpdateVariable>
  example: |-
    <UpdateVariable>
        <Analysis>
            当前时间: Time passes 10 mins. Update to 16:30. (replace)
            主线任务: Task completed. MOVE from '进行中' (index 0) to '已完成'. (move)
            玲奈.亲密度: Old(0.500) + 0.007 = 0.507. (replace)
            玲奈.重要成就(New): Today is a new date, so add a new key. (add)
            玲奈.重要成就(Update): A new event happened later, so update the existing key. (replace)
            玲奈.余额: Old(100.0) - 10.0 = 90.0. (replace)
            玲奈.着装: She took off '外套' (index 0). (remove)
        </Analysis>
        <JSONPatch>
    [
      { "op": "replace", "path": "/当前时间", "value": "2022-10-17T16:30:00" },
      { "op": "move", "from": "/主线任务/进行中/0", "path": "/主线任务/已完成/-" },
      { "op": "replace", "path": "/玲奈/亲密度", "value": 0.507 },
      { "op": "add", "path": "/玲奈/重要成就/2022年10月18日", "value": "玲奈与<user>相遇。" },
      { "op": "replace", "path": "/玲奈/重要成就/2022年10月18日", "value": "玲奈与<user>相遇，并交换了手机号。" },
      { "op": "replace", "path": "/玲奈/余额", "value": 90.0 },
      { "op": "remove", "path": "/玲奈/着装/0" }
    ]
        </JSONPatch>
    </UpdateVariable>
```


## 杂项变更

### StrictSet

在原本的 MVU 中，使用了 ValueWithDescription(后记 VWD) 语义。即：
 - 将一个一个大小正好为 2，第二个元素为 `string` 类型的数组视为一个 `值-变更条件` 对。

对这种类型进行变更时，除非直接指定，否则只会变更其第 0 个下标的内容。如：
```json
{
    "生命": [20, "受到伤害时减少"]
}
```
对其使用语句 `_.set('生命', 14);` 的效果是 `"生命": [14, "受到伤害时减少"]`, 而不是 `"生命": 14`。
类似的，对其使用语句 `_.set('生命', [14, '我带你打']);` 的效果是 `"生命": [[14, '我带你打'], "受到伤害时减少"]`, 而不是 `"生命": [14, '我带你打']`。
这种处理可以避免部分情况下 LLM 发癫，将变更条件破坏。

但是这种做法显然会影响部分对数组的正常赋值。因此在 beta 分支下，我们提供了配置项来开关这种特性，即下面的`strictSet`
```json5
{
    "$meta": {
        "strictSet": true,
    },
    "生命": [20, "受到伤害时减少"]
}
```
当配置后，对其使用语句 `_.set('生命', 14);` 的效果是 `"生命": 14`。需要显式指定数组下标才能正确赋值。
