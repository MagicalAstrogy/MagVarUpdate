import fs from 'node:fs';
import path from 'node:path';

type CapturedMessage = {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
};

type PromptCaptureFixture = {
    schemaVersion: number;
    route: string;
    provenance: {
        sillyTavernVersion: string;
        sillyTavernRevision: string;
        tavernHelperVersion: string;
        firefoxVersion: string;
        artifactSha256: string;
        sourceCard: string;
        dataRoot: string;
        realBrowserCapture: boolean;
    };
    normalization: unknown[];
    allowedDifferences: unknown[];
    legacy: CapturedMessage[];
    pi: CapturedMessage[];
};

const fixtureRoot = path.join(process.cwd(), 'tests', 'fixtures', 'pi_prompt_capture');
const fixtureCases = [
    ['current_preset', '使用当前预设'],
    ['other_preset', '使用其他预设'],
    ['builtin_jailbreak', '使用内置破限'],
] as const;

function readFixture(name: string): PromptCaptureFixture {
    return JSON.parse(
        fs.readFileSync(path.join(fixtureRoot, name + '.json'), 'utf8')
    ) as PromptCaptureFixture;
}

function flattenedText(messages: CapturedMessage[]): string {
    return messages.map(message => message.content).join('\n');
}

function markerMessageIndexes(messages: CapturedMessage[], marker: string): number[] {
    return messages.flatMap((message, index) => (message.content.includes(marker) ? [index] : []));
}

function standaloneMarkerIndexes(messages: CapturedMessage[], marker: string): number[] {
    return messages.flatMap((message, index) =>
        message.content.split(/\r?\n/).some(line => line.trim() === marker) ? [index] : []
    );
}

function countOccurrences(text: string, marker: string): number {
    return text.split(marker).length - 1;
}

describe('real SillyTavern Pi prompt capture fixtures', () => {
    test('contains exactly the three supported jailbreak routes', () => {
        expect(
            fs
                .readdirSync(fixtureRoot)
                .filter(file => file.endsWith('.json'))
                .sort()
        ).toEqual(['builtin_jailbreak.json', 'current_preset.json', 'other_preset.json']);
    });

    test.each(fixtureCases)(
        '%s records real-browser provenance and exact parity',
        (name, route) => {
            const fixture = readFixture(name);

            expect(fixture.schemaVersion).toBe(1);
            expect(fixture.route).toBe(route);
            expect(fixture.provenance.realBrowserCapture).toBe(true);
            expect(fixture.provenance.sillyTavernVersion.length > 0).toBe(true);
            expect(fixture.provenance.sillyTavernRevision.length > 0).toBe(true);
            expect(fixture.provenance.tavernHelperVersion.length > 0).toBe(true);
            expect(fixture.provenance.firefoxVersion.length > 0).toBe(true);
            expect(/^[0-9a-f]{64}$/.test(fixture.provenance.artifactSha256)).toBe(true);
            expect(fixture.provenance.sourceCard).toBe('example/artifact/青空 理_mvu_update.png');
            expect(fixture.provenance.dataRoot).toBe('isolated-temporary');
            expect(fixture.normalization).toEqual([]);
            expect(fixture.allowedDifferences).toEqual([]);
            expect(fixture.legacy.length > 0).toBe(true);
            expect(JSON.stringify(fixture.pi) === JSON.stringify(fixture.legacy)).toBe(true);
        }
    );

    test.each(fixtureCases)('%s covers prompt construction and filtering semantics', name => {
        const fixture = readFixture(name);
        const messages = fixture.legacy;
        const text = flattenedText(messages);

        const retainedMarkers = [
            'B04_CHARACTER_CARD',
            'B04_WORLD_UPDATE_KEEP',
            'B04_WORLD_ALLOW_KEEP',
            'B04_WORLD_DEPTH_KEEP',
            'B04_HISTORY_KEEP_USER',
            'B04_HISTORY_KEEP_ASSISTANT',
            'B04_REGEX_APPLIED',
        ];
        for (const marker of retainedMarkers) {
            expect(countOccurrences(text, marker)).toBe(1);
        }

        const filteredMarkers = [
            'B04_HISTORY_PRUNED_USER',
            'B04_HISTORY_PRUNED_ASSISTANT',
            'B04_REGEX_SOURCE',
            'B04_WORLD_BLACKLIST_DROP',
            'B04_WORLD_PLOT_DROP',
            '<StatusPlaceHolderImpl/>',
            '{{lastUserMessage}}',
        ];
        for (const marker of filteredMarkers) {
            expect(text.includes(marker)).toBe(false);
        }

        for (const marker of [
            'B04_CHARACTER_CARD',
            'B04_WORLD_UPDATE_KEEP',
            'B04_WORLD_ALLOW_KEEP',
            'B04_WORLD_DEPTH_KEEP',
        ]) {
            const indexes = markerMessageIndexes(messages, marker);
            expect(indexes.length).toBe(1);
            expect(messages[indexes[0]].role).toBe('system');
        }

        const keptUser = markerMessageIndexes(messages, 'B04_HISTORY_KEEP_USER');
        const keptAssistant = markerMessageIndexes(messages, 'B04_HISTORY_KEEP_ASSISTANT');
        const regexApplied = markerMessageIndexes(messages, 'B04_REGEX_APPLIED');
        expect(keptUser.length).toBe(1);
        expect(keptAssistant.length).toBe(1);
        expect(regexApplied.length).toBe(1);
        expect(messages[keptUser[0]].role).toBe('user');
        expect(messages[keptAssistant[0]].role).toBe('assistant');
        expect(messages[regexApplied[0]].role).toBe('user');

        const worldMacro = markerMessageIndexes(messages, 'B04_WORLD_ALLOW_KEEP');
        expect(messages[worldMacro[0]].content.includes('<must>')).toBe(true);

        const open = standaloneMarkerIndexes(messages, '<past_observe>');
        const close = standaloneMarkerIndexes(messages, '</past_observe>');
        expect(open.length).toBe(1);
        expect(close.length).toBe(1);
        expect(open[0] < keptAssistant[0]).toBe(true);
        expect(keptAssistant[0] < close[0]).toBe(true);
        expect(
            messages.some(
                (message, index) =>
                    index > close[0] &&
                    message.role === 'system' &&
                    message.content.includes('<must>')
            )
        ).toBe(true);
    });

    test.each(fixtureCases)(
        '%s proves its route identity without control leakage',
        (name, route) => {
            const fixture = readFixture(name);
            const messages = fixture.legacy;
            const text = flattenedText(messages);
            const serialized = JSON.stringify(messages);

            for (const message of messages) {
                expect(Object.keys(message).sort()).toEqual(['content', 'role']);
                expect(['system', 'user', 'assistant']).toContain(message.role);
                expect(typeof message.content === 'string' && message.content.length > 0).toBe(
                    true
                );
            }

            if (route === '使用内置破限') {
                expect(standaloneMarkerIndexes(messages, '<additional_information>').length).toBe(
                    1
                );
                expect(standaloneMarkerIndexes(messages, '</additional_information>').length).toBe(
                    1
                );
                expect(text.includes('B04_PRESET_MACRO')).toBe(false);
                expect(text.includes('B04_PRESET_DEPTH_KEEP')).toBe(false);
            } else {
                expect(countOccurrences(text, 'B04_PRESET_MACRO')).toBe(1);
                expect(countOccurrences(text, 'B04_PRESET_DEPTH_KEEP')).toBe(1);
                const macroMessage = markerMessageIndexes(messages, 'B04_PRESET_MACRO');
                expect(messages[macroMessage[0]].content.includes('<must>')).toBe(true);
                expect(standaloneMarkerIndexes(messages, '<additional_information>').length).toBe(
                    0
                );
            }

            const forbiddenControls = [
                'mvu-pi-prompt-capture:',
                'mvu-pi-prompt-capture.invalid',
                'b04-legacy-control.invalid',
                'b04-pi-control.invalid',
                'b04-legacy-control-key',
                'b04-pi-control-key',
                'claude-b04-control-model',
                '/home/',
                '/tmp/',
            ];
            for (const control of forbiddenControls) {
                expect(serialized.includes(control)).toBe(false);
            }

            const toolCount = messages.filter(message => message.role === 'tool').length;
            expect(toolCount).toBe(0);
        }
    );

    test('current and named preset captures are distinct real prompt paths', () => {
        const current = readFixture('current_preset').legacy;
        const other = readFixture('other_preset').legacy;

        expect(JSON.stringify(current) === JSON.stringify(other)).toBe(false);
        expect(current.length).not.toBe(other.length);
    });
});
