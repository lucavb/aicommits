import type { JestConfigWithTsJest } from 'ts-jest';

import { defaults as tsjPreset } from 'ts-jest/presets';

export default {
    preset: 'ts-jest',
    testEnvironment: 'node',
    transform: {
        ...tsjPreset.transform,
    },
    setupFiles: ['<rootDir>/setup-jest.ts'],
} satisfies JestConfigWithTsJest;
