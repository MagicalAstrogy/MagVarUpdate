import { OpReplace } from 'json-joy/lib/json-patch';
import { decode } from 'json-joy/lib/json-patch/codec/json';
import { MvuData } from '@/variable_def';
import { CommandInfo } from '@/export_globals';

export function commandParsed(
    _variables: MvuData,
    commands: CommandInfo[],
    message_content: string
) {
    if (message_content) {
        //解析所有 <JsonPatch> 块内的内容，视为一个有效的json
        // 免责声明：下面代码仅供功能演示用，不对健壮性做保证。
        const jsonPatchRegex = /<JsonPatch>([\s\S]*?)<\/JsonPatch>/gi;

        let match: RegExpExecArray | null;
        while ((match = jsonPatchRegex.exec(message_content)) !== null) {
            const rawContent = match[1].trim();
            if (!rawContent) continue;

            let operations: any[] = [];
            try {
                const parsed = JSON.parse(rawContent);
                operations = Array.isArray(parsed) ? parsed : [parsed];
            } catch (error) {
                console.warn('[JsonPatch] Failed to parse patch block:', error);
                continue;
            }
            const decoded_contents = decode(operations, {});
            for (const op of decoded_contents) {
                switch (op.op()) {
                    case 'replace': {
                        const current = op as OpReplace;
                        commands.push({
                            args: [current.path.join('.'), JSON.stringify(current.value)],
                            full_match: JSON.stringify(op.toJson()),
                            reason: '',
                            type: 'set',
                        });
                    }
                }
            }
        }
    }
}
