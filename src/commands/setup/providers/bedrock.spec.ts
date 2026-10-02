import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ClackPromptService } from '../../../services/clack-prompt.service';
import { type ModelSetupContext, type ModelSetupResult } from './types';
import { bedrockHandler } from './bedrock';

const { sendMock } = vi.hoisted(() => ({
    sendMock: vi.fn(),
}));

vi.mock('@aws-sdk/client-bedrock', () => ({
    BedrockClient: class {
        readonly send = sendMock;
    },
    ListFoundationModelsCommand: class {},
    ListInferenceProfilesCommand: class {},
}));

// Fixture replicating a remote-sourced Bedrock error message carrying C0/ESC/OSC-8
// control bytes (OSC-8 hyperlink terminator BEL included), as delivered verbatim by
// the restJson1 error deserializer when the endpoint is attacker-selected.
const FIXTURE_MESSAGE = 'line1\n\u001b]8;;http://example.invalid\u0007PHISH\n\u001b]8;;\u0007line2';
const EXPECTED_STDERR_MESSAGE =
    'Failed to fetch models. See the message above and check your AWS credentials, region and network.';

const setupContext: ModelSetupContext = {
    profile: 'default',
    // Bedrock needs no API key; the handler never consults the credential.
    locateCredential: () => ({
        required: false,
        candidates: [],
    }),
};

const spinnerStops: string[] = [];

const promptUI = {
    note: vi.fn(),
    spinner: () => ({
        start: vi.fn(),
        stop: (message?: string) => {
            if (message) {
                spinnerStops.push(message);
            }
        },
    }),
    select: vi.fn(),
} as unknown as ClackPromptService;

describe('bedrockHandler.setup fetch failure diagnostics', () => {
    beforeEach(() => {
        spinnerStops.length = 0;
        sendMock.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const captureStderr = (): {
        stderrWrites: string[];
        joinWrites: () => string;
    } => {
        const stderrWrites: string[] = [];
        // Vitest intercepts console.error instead of forwarding to the real
        // process.stderr, so capture at the console boundary — the actual sink the
        // bedrock catch block writes to. The writer's own formatting (space-join of
        // args, trailing newline) is emulated to keep assertions byte-faithful.
        vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
            stderrWrites.push(`${args.join(' ')}\n`);
        });
        return {
            stderrWrites,
            joinWrites: () => stderrWrites.join(''),
        };
    };

    it('must not echo raw Error text with escape sequences to stderr when model lookup fails', async () => {
        sendMock.mockRejectedValue(new Error(FIXTURE_MESSAGE));
        const { joinWrites } = captureStderr();

        const result: ModelSetupResult = await bedrockHandler.setup(promptUI, setupContext);

        expect(result.model).toBeNull();
        expect(joinWrites()).toBe(`${EXPECTED_STDERR_MESSAGE}\n`);
        expect(joinWrites()).not.toContain('\u001b');
        expect(joinWrites()).not.toContain('\u0007');
        expect(joinWrites()).not.toContain('PHISH');
        expect(joinWrites()).not.toContain('line1');
        expect(joinWrites()).not.toContain('line2');
        expect(spinnerStops).toEqual([
            expect.stringContaining('Failed to fetch models. Check your AWS credentials and region.'),
        ]);
    });

    it('must not echo non-Error rejection values to stderr when model lookup fails', async () => {
        sendMock.mockRejectedValue(FIXTURE_MESSAGE);
        const { joinWrites } = captureStderr();

        const result: ModelSetupResult = await bedrockHandler.setup(promptUI, setupContext);

        expect(result.model).toBeNull();
        expect(joinWrites()).toBe(`${EXPECTED_STDERR_MESSAGE}\n`);
        expect(joinWrites()).not.toContain('PHISH');
    });
});
