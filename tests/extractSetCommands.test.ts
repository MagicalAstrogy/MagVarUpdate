import { extractCommands, parseCommandValue } from '../src/function';

describe('extractCommands', () => {
    describe('基本功能测试', () => {
        test('提取简单的 _.set 调用', () => {
            const input = `_.set('name', 'John', 'Jane');//更新名字`;
            const result = extractCommands(input);

            expect(result).toHaveLength(1);
            const cmd = result[0];
            expect(cmd.command).toBe('set');
            expect(cmd.fullMatch).toBe(`_.set('name', 'John', 'Jane');//更新名字`);
            expect(cmd.reason).toBe('更新名字');
            expect(cmd.args).toEqual(["'name'", "'John'", "'Jane'"]);

            expect(parseCommandValue(cmd.args[0])).toBe('name');
            expect(parseCommandValue(cmd.args[1])).toBe('John');
            expect(parseCommandValue(cmd.args[2])).toBe('Jane');
        });

        test('处理两个参数的 _.set 调用', () => {
            const input = `_.set('时间', "09:15");//设置时间`;
            const result = extractCommands(input);

            expect(result).toHaveLength(1);
            const cmd = result[0];
            expect(cmd.command).toBe('set');
            expect(cmd.fullMatch).toBe(`_.set('时间', "09:15");//设置时间`);
            expect(cmd.reason).toBe('设置时间');
            expect(cmd.args).toEqual(["'时间'", '"09:15"']);

            expect(parseCommandValue(cmd.args[0])).toBe('时间');
            expect(parseCommandValue(cmd.args[1])).toBe('09:15');
        });

        test('提取多个 _.set 调用', () => {
            const input = `
                _.set('time', '08:00', '09:00');//更新时间
                _.set('location', '家', '公司');//更新位置
            `;
            const result = extractCommands(input);

            expect(result).toHaveLength(2);
            expect(result[0].command).toBe('set');
            expect(parseCommandValue(result[0].args[0])).toBe('time');
            expect(result[1].command).toBe('set');
            expect(parseCommandValue(result[1].args[0])).toBe('location');
        });
    });

    describe('嵌套括号处理', () => {
        test('处理参数中包含 _.set 的情况', () => {
            const input = `_.set('悠纪.想对user说的事', ["与希雅 在一起时，会邀请希雅做一些事情，是 出去喝一杯咖啡，接下来设置变量\\"_.set('当前事件',null,'yuki_relation_level1');//邀请希雅\\"，然后断章。"], []);//邀请已经发出并被接受，待办事项完成并清空。`;
            const result = extractCommands(input);

            expect(result).toHaveLength(1);
            const cmd = result[0];
            expect(cmd.command).toBe('set');
            expect(parseCommandValue(cmd.args[0])).toBe('悠纪.想对user说的事');
            expect(cmd.reason).toBe('邀请已经发出并被接受，待办事项完成并清空。');
            // 验证没有错误地提取内部的 _.set
            expect(cmd.fullMatch).toContain('待办事项完成并清空。');
        });

        test('处理嵌套数组和对象', () => {
            const input = `_.set('data', {arr: [1, 2, {nested: "value)}"}]}, {arr: [3, 4]});//更新数据`;
            const result = extractCommands(input);

            expect(result).toHaveLength(1);
            const cmd = result[0];
            expect(cmd.command).toBe('set');
            expect(parseCommandValue(cmd.args[0])).toBe('data');
            expect(cmd.reason).toBe('更新数据');
            expect(parseCommandValue(cmd.args[1])).toEqual({ arr: [1, 2, { nested: "value)}" }] });
            expect(parseCommandValue(cmd.args[2])).toEqual({ arr: [3, 4] });
        });

        test('处理包含括号的字符串', () => {
            const input = `_.set('message', "Hello (world)", "Goodbye (world)");//更改消息`;
            const result = extractCommands(input);

            expect(result).toHaveLength(1);
            const cmd = result[0];
            expect(cmd.command).toBe('set');
            expect(parseCommandValue(cmd.args[1])).toBe('Hello (world)');
            expect(parseCommandValue(cmd.args[2])).toBe('Goodbye (world)');
        });
    });

    describe('引号处理', () => {
        test('处理混合引号', () => {
            const input = `_.set("path", 'old"value', "new'value");//混合引号`;
            const result = extractCommands(input);

            expect(result).toHaveLength(1);
            const cmd = result[0];
            expect(cmd.command).toBe('set');
            expect(parseCommandValue(cmd.args[1])).toBe('old"value');
            expect(parseCommandValue(cmd.args[2])).toBe("new'value");
        });

        test('处理转义引号', () => {
            const input = `_.set('path', "value with \\"quotes\\"", 'new value');//转义引号`;
            const result = extractCommands(input);

            expect(result).toHaveLength(1);
            const cmd = result[0];
            expect(cmd.command).toBe('set');
            expect(parseCommandValue(cmd.args[1])).toBe('value with "quotes"');
        });

        test('处理反引号（模板字符串）', () => {
            const input = "_.set('template', `Hello ${name}`, `Goodbye ${name}`);//模板字符串";
            const result = extractCommands(input);

            expect(result).toHaveLength(1);
            const cmd = result[0];
            expect(cmd.command).toBe('set');
            expect(parseCommandValue(cmd.args[1])).toBe('Hello ${name}');
            expect(parseCommandValue(cmd.args[2])).toBe('Goodbye ${name}');
        });
    });

    describe('注释处理', () => {
        test('处理无注释的情况', () => {
            const input = `_.set('name', 'old', 'new');`;
            const result = extractCommands(input);

            expect(result).toHaveLength(1);
            expect(result[0].reason).toBe('');
        });

        test('处理带空格的注释', () => {
            const input = `_.set('name', 'old', 'new'); // 这是一个注释`;
            const result = extractCommands(input);

            expect(result).toHaveLength(1);
            expect(result[0].reason).toBe('这是一个注释');
        });

        test('处理多行文本中的注释', () => {
            const input = `_.set('name', 'old', 'new');//第一个注释\n_.set('age', 20, 21);//第二个注释`;
            const result = extractCommands(input);

            expect(result).toHaveLength(2);
            expect(result[0].reason).toBe('第一个注释');
            expect(result[1].reason).toBe('第二个注释');
        });
    });

    describe('边界情况', () => {
        test('处理空输入', () => {
            const result = extractCommands('');
            expect(result).toHaveLength(0);
        });

        test('处理没有 _.set 的文本', () => {
            const input = 'This is just some regular text without set commands';
            const result = extractCommands(input);
            expect(result).toHaveLength(0);
        });

        test('处理不完整的 _.set 调用', () => {
            const input = `_.set('name'`; // 缺少闭括号
            const result = extractCommands(input);
            expect(result).toHaveLength(0);
        });

        test('处理缺少分号的 _.set 调用', () => {
            const input = `_.set('name', 'old', 'new')`; // 缺少分号
            const result = extractCommands(input);
            expect(result).toHaveLength(0);
        });

        test('处理参数不足的情况', () => {
            const input = `_.set('name');//只有一个参数`;
            const result = extractCommands(input);
            expect(result).toHaveLength(0);
        });
    });

    describe('复杂场景', () => {
        test('处理混合内容', () => {
            const input = `
                Some text before
                _.set('status', 'pending', 'active');//更新状态
                More text in between
                _.set('count', 0, 1);
                _.set('data', ["item with ); inside"], ["new item"]);//包含特殊字符
                Final text
            `;
            const result = extractCommands(input);

            expect(result).toHaveLength(3);
            expect(parseCommandValue(result[0].args[0])).toBe('status');
            expect(parseCommandValue(result[1].args[0])).toBe('count');
            expect(parseCommandValue(result[2].args[0])).toBe('data');
            expect(parseCommandValue(result[2].args[1])).toStrictEqual(["item with ); inside"]);
        });

        test('处理实际的复杂案例', () => {
            const input = `
                用户说了一些话，然后系统需要更新变量。
                _.set('用户.心情', '平静', '开心');//因为收到了好消息
                _.set('系统.响应', ["需要处理的事项", "包含特殊字符);的内容"], ["已处理"]);//处理完成
                _.set('时间戳', '2024-01-01', '2024-01-02');
            `;
            const result = extractCommands(input);

            expect(result).toHaveLength(3);
            expect(result[0].reason).toBe('因为收到了好消息');
            expect(result[1].reason).toBe('处理完成');
            expect(result[2].reason).toBe('');
        });
    });
});

describe('Assign 和 Remove 命令测试', () => {
    test('简单的 assign 调用（向数组追加）', () => {
        const input = `_.assign('inventory', 'healing potion');//获得治疗药水`;
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        const cmd = result[0];
        expect(cmd.command).toBe('assign');
        expect(cmd.reason).toBe('获得治疗药水');
        expect(parseCommandValue(cmd.args[0])).toBe('inventory');
        expect(parseCommandValue(cmd.args[1])).toBe('healing potion');
    });

    test('带索引的 assign 调用（向数组特定位置插入）', () => {
        const input = `_.assign('quest_log', 0, '主线任务：寻找古代遗物');`;
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        const cmd = result[0];
        expect(cmd.command).toBe('assign');
        expect(parseCommandValue(cmd.args[0])).toBe('quest_log');
        expect(parseCommandValue(cmd.args[1])).toBe(0);
        expect(parseCommandValue(cmd.args[2])).toBe('主线任务：寻找古代遗物');
    });

    test('复杂的 assign 调用（向对象添加键值对）', () => {
        const input = `_.assign('悠纪.金手指系统', "体育生系统", {"功能": "让人体能飞升，变身体育生！", "是否激活": false});//添加金手指`;
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        const cmd = result[0];
        expect(cmd.command).toBe('assign');
        expect(cmd.reason).toBe('添加金手指');
        expect(parseCommandValue(cmd.args[0])).toBe('悠纪.金手指系统');
        expect(parseCommandValue(cmd.args[1])).toBe('体育生系统');
        expect(parseCommandValue(cmd.args[2])).toStrictEqual({ "功能": "让人体能飞升，变身体育生！", "是否激活": false });
    });

    test('简单的 remove 调用（删除属性）', () => {
        const input = `_.remove('user.status.is_tired');//不再疲劳`;
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        const cmd = result[0];
        expect(cmd.command).toBe('remove');
        expect(cmd.reason).toBe('不再疲劳');
        expect(cmd.args).toHaveLength(1);
        expect(parseCommandValue(cmd.args[0])).toBe('user.status.is_tired');
    });

    test('带索引的 remove 调用（从数组删除）', () => {
        const input = `_.remove('tasks', 2);//完成第三个任务`;
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        const cmd = result[0];
        expect(cmd.command).toBe('remove');
        expect(cmd.reason).toBe('完成第三个任务');
        expect(parseCommandValue(cmd.args[0])).toBe('tasks');
        expect(parseCommandValue(cmd.args[1])).toBe(2);
    });

    test('带值的 remove 调用（从数组删除特定项）', () => {
        const input = `_.remove('debuffs', 'poison_effect');//中毒效果已解除`;
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        const cmd = result[0];
        expect(cmd.command).toBe('remove');
        expect(cmd.reason).toBe('中毒效果已解除');
        expect(parseCommandValue(cmd.args[0])).toBe('debuffs');
        expect(parseCommandValue(cmd.args[1])).toBe('poison_effect');
    });
});

describe('Modify 命令测试', () => {
    test('简单的 modify 调用（切换布尔值）', () => {
        const input = `_.modify('user.is_active');//切换活跃状态`;
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        const cmd = result[0];
        expect(cmd.command).toBe('modify');
        expect(cmd.reason).toBe('切换活跃状态');
        expect(cmd.args).toHaveLength(1);
        expect(parseCommandValue(cmd.args[0])).toBe('user.is_active');
    });

    test('带增量的 modify 调用（调整数值）', () => {
        const input = `_.modify('player.health', 10);//恢复10点生命值`;
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        const cmd = result[0];
        expect(cmd.command).toBe('modify');
        expect(cmd.reason).toBe('恢复10点生命值');
        expect(parseCommandValue(cmd.args[0])).toBe('player.health');
        expect(parseCommandValue(cmd.args[1])).toBe(10);
    });

    test('复杂路径的 modify 调用', () => {
        const input = `_.modify('悠纪.金手指系统.是否激活');//激活金手指`;
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        const cmd = result[0];
        expect(cmd.command).toBe('modify');
        expect(cmd.reason).toBe('激活金手指');
        expect(parseCommandValue(cmd.args[0])).toBe('悠纪.金手指系统.是否激活');
    });

    test('带数学表达式的 modify 调用', () => {
        const input = `_.modify('score.total', 100 * 2 + 50);//增加250分`;
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        const cmd = result[0];
        expect(cmd.command).toBe('modify');
        expect(cmd.reason).toBe('增加250分');
        expect(parseCommandValue(cmd.args[0])).toBe('score.total');
        expect(parseCommandValue(cmd.args[1])).toBe(250);
    });

    test('无效参数数量的 modify 调用', () => {
        const input = `_.modify('path', 10, 20);//参数过多`;
        const result = extractCommands(input);

        expect(result).toHaveLength(0); // 无效命令应被过滤
    });

    test('缺少分号的 modify 调用', () => {
        const input = `_.modify('path', 5)`; // 缺少分号
        const result = extractCommands(input);

        expect(result).toHaveLength(0);
    });

    test('混合命令中的 modify 调用', () => {
        const input = `
            _.set('name', 'old', 'new');//更新名字
            _.modify('user.is_online');//切换在线状态
            _.assign('items', 'sword');//添加武器
            _.modify('player.mana', 20);//增加20点魔法值
        `;
        const result = extractCommands(input);

        expect(result).toHaveLength(4);
        expect(result[1].command).toBe('modify');
        expect(parseCommandValue(result[1].args[0])).toBe('user.is_online');
        expect(result[1].args).toHaveLength(1);

        expect(result[3].command).toBe('modify');
        expect(parseCommandValue(result[3].args[0])).toBe('player.mana');
        expect(parseCommandValue(result[3].args[1])).toBe(20);
    });
});

describe('数学和表达式测试', () => {

    test('处理基本的四则运算', () => {
        const input = "_.set('悠纪.好感度', 10, 10 + 2 * 5 - 3 / 3);//羁绊加深";
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        expect(parseCommandValue(result[0].args[2])).toBe(19); // 10 + 10 - 1 = 19
    });

    test('处理带括号的复杂运算', () => {
        const input = "_.set('角色.理智', 100, (100 - 30) / (2 + 5));//执行任务消耗理智";
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        expect(parseCommandValue(result[0].args[2])).toBe(10); // 70 / 7 = 10
    });

    test('处理指对幂运算', () => {
        const input = "_.set('世界.魔力浓度', 1000, log(10^3, 10) * sqrt(144));//魔力共鸣";
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        expect(parseCommandValue(result[0].args[2])).toBe(36); // log(1000, 10) is 3, sqrt(144) is 12. 3 * 12 = 36.
    });

    test('处理三角函数和常数', () => {
        const input = "_.set('魔法.相位角', 0, cos(pi) + 2);//相位反转";
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        expect(parseCommandValue(result[0].args[2])).toBe(1); // cos(pi) is -1. -1 + 2 = 1.
    });

    test('参数是字符串，不应错误地执行运算', () => {
        const input = "_.set('笔记.内容', '旧内容', '10 + 2');//记录算式";
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        expect(parseCommandValue(result[0].args[2])).toBe('10 + 2'); // 应该得到字符串 '10 + 2'，而不是数字 12
    });

    test('参数是包含字符串的JSON结构，不应错误地执行运算（以日期为例）', () => {
        const input = "_.set('日期', ['2015-01-01', '当前日期 YYYY - MM - DD']);";//设置日期";
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        expect(parseCommandValue(result[0].args[1])).toStrictEqual(['2015-01-01', '当前日期 YYYY - MM - DD']);
    });

    test('不应将普通的字符串误判为微积分（例如包含derivative）', () => {
        const input = "_.set('笔记.内容', 'old', 'derivative('x^3', 'x').evaluate({x: 2})');//记录算式";
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        expect(parseCommandValue(result[0].args[2])).toBe('derivative(\'x^3\', \'x\').evaluate({x: 2})');
    });

    test('处理 cmath + JS Math + mathjs 混合运算', () => {
        const input = "_.set('悠纪.余额', 10, Math.floor(( Math.PI * 100 ) / 3 + math.pow(5, 3)) + derivative('x^3', 'x').evaluate({x: 2}));//获得奖励";
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        expect(parseCommandValue(result[0].args[2])).toBe(241);
    });
});

describe('高等数学与高级运算测试', () => {

    test('处理微积分（求导）运算', () => {
        // 求函数 f(x) = x^3 在 x = 2 时的导数值 (f'(x) = 3x^2, f'(2) = 3 * 2^2 = 12)
        const input = "_.set('函数.斜率', 0, derivative('x^3', 'x').evaluate({x: 2}));//计算瞬时变化率";
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        expect(parseCommandValue(result[0].args[2])).toBe(12);
    });

    test('处理复数运算', () => {
        // 计算 (2 + 3i) * (1 - 2i) = 2 - 4i + 3i - 6i^2 = 2 - i + 6 = 8 - i
        const input = "_.set('电路.阻抗', 0, (2 + 3i) * (1 - 2i));//复数乘法";
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        // 逻辑会将 Complex 对象格式化为字符串
        expect(parseCommandValue(result[0].args[2])).toBe('8 - i');
    });

    test('处理线性代数（矩阵行列式）', () => {
        // 计算矩阵 [[-1, 2], [3, 1]] 的行列式 (-1 * 1) - (2 * 3) = -7
        const input = "_.set('矩阵.行列式', 0, det([[-1, 2], [3, 1]]));//计算2x2矩阵的行列式";
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        expect(parseCommandValue(result[0].args[2])).toBe(-7);
    });

    test('处理线性代数（矩阵乘法）', () => {
        // 计算矩阵乘法 [1, 2; 3, 4] * [5; 6] = [1*5+2*6; 3*5+4*6] = [17; 39]
        const input = "_.set('线性变换.结果', [0], [1, 2; 3, 4] * [5; 6]);//应用一个线性变换";
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        // 逻辑会将 Matrix 对象格式化为字符串
        expect(parseCommandValue(result[0].args[2])).toBe('[[17], [39]]');
    });

    test('处理统计运算（标准差）', () => {
        // 计算样本标准差
        const input = "_.set('数据分析.离散度', 0, std([2, 4, 6, 8]));//计算标准差";
        const result = extractCommands(input);

        expect(result).toHaveLength(1);
        // std([2, 4, 6, 8]) ≈ 2.5819...
        expect(parseCommandValue(result[0].args[2])).toBeCloseTo(2.581988897);
    });
});
/* 实验性功能，暂不启用
describe('日期处理与时间运算测试', () => {
    test('将 ISO 8601 标准格式的字符串解析为 Date 对象', () => {
        const input = "_.set('事件.开始时间', null, '2024-07-26T10:00:00.000Z');//设定具体时间";
        const result = extractCommands(input);
        expect(result).toHaveLength(1);
        expect(parseCommandValue(result[0].args[2])).toEqual(new Date('2024-07-26T10:00:00.000Z'));
        expect(result[0].reason).toBe('设定具体时间');
    });

    test('将多种常见的日期字符串格式解析为 Date 对象', () => {
        const input = "_.set('历史.重要日期', 'old', 'December 17, 1995 03:24:00');//记录一个历史时刻";
        const result = extractCommands(input);
        expect(result).toHaveLength(1);
        expect(parseCommandValue(result[0].args[2])).toEqual(new Date('December 17, 1995 03:24:00'));
    });

    test('解析仅包含日期的字符串（YYYY-MM-DD）', () => {
        const input = "_.set('假期.开始日期', null, '2025-01-01');//新年第一天";
        const result = extractCommands(input);
        expect(result).toHaveLength(1);
        // JS `new Date()` 在没有时区信息时，会根据运行环境的时区来解析。为保证测试一致性，我们验证它是否为UTC午夜。
        expect(parseCommandValue(result[0].args[2])).toEqual(new Date('2025-01-01T00:00:00.000Z'));
    });

    test('正确解析用于时间增减的命令', () => {
        // 增加10分钟
        const input = "_.modify('世界.当前时间', 10 * 60 * 1000);//时间流逝10分钟";
        const result = extractCommands(input);
        expect(result).toHaveLength(1);
        const cmd = result[0];
        expect(cmd.command).toBe('modify');
        expect(parseCommandValue(cmd.args[0])).toBe('世界.当前时间');
        expect(parseCommandValue(cmd.args[1])).toBe(600000);
        expect(cmd.reason).toBe('时间流逝10分钟');
    });

    test('处理负数增量（时间倒流）', () => {
        // 时间倒退一小时
        const input = "_.modify('时间机器.目标时间', -3600 * 1000);//启动时间机器，回到一小时前";
        const result = extractCommands(input);
        expect(result).toHaveLength(1);
        const cmd = result[0];
        expect(cmd.command).toBe('modify');
        expect(parseCommandValue(cmd.args[0])).toBe('时间机器.目标时间');
        expect(parseCommandValue(cmd.args[1])).toBe(-3600000);
        expect(cmd.reason).toBe('启动时间机器，回到一小时前');
    });

    test('不应将纯数字字符串错误地解析为 Date 对象', () => {
        // 这是一个纯数字字符串，应该被解析为数字，而不是一个日期对象
        const input = "_.set('记录.编号', '0', '1672531200000');//记录时间戳数字";
        const result = extractCommands(input);
        expect(result).toHaveLength(1);
        // `parseCommandValue` 会将纯数字字符串解析为数字
        expect(parseCommandValue(result[0].args[2])).toBe(1672531200000);
        expect(parseCommandValue(result[0].args[2])).not.toBeInstanceOf(Date);
    });

    test('处理非标准的但可被JS Date解析的疯狂格式（RFC 2822）', () => {
        const input = "_.set('古代遗物.发现日期', 'unknown', 'Mon, 25 Dec 1995 13:30:00 GMT');//考古重大发现";
        const result = extractCommands(input);
        expect(result).toHaveLength(1);
        expect(parseCommandValue(result[0].args[2])).toEqual(new Date('Mon, 25 Dec 1995 13:30:00 GMT'));
        expect(result[0].reason).toBe('考古重大发现');
    });

    test('结合数学表达式来增加一天', () => {
        // 增加一天
        const input = "_.modify('日记.日期', 24 * 60 * 60 * 1000);//翻到下一页";
        const result = extractCommands(input);
        expect(result).toHaveLength(1);
        const cmd = result[0];
        expect(cmd.command).toBe('modify');
        expect(parseCommandValue(cmd.args[0])).toBe('日记.日期');
        expect(parseCommandValue(cmd.args[1])).toBe(86400000);
        expect(cmd.reason).toBe('翻到下一页');
    });
});
*/
