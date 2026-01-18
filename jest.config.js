/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src', '<rootDir>/tests'],
    testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
    transform: {
        '^.+\\.ts$': 'ts-jest',
    },
    moduleNameMapper: {
        '^@/(.*)\\?raw$': '<rootDir>/tests/mocks/rawTextMock.ts',
        '\\.txt\\?raw$': '<rootDir>/tests/mocks/rawTextMock.ts',
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/**/index.ts'],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    globals: {
        'ts-jest': {
            tsconfig: 'tsconfig.test.json',
        },
    },
    setupFiles: ['jest-localstorage-mock'],
    setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
};
