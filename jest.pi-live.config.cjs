/** 独立 ESM 测试入口：加载真实 SDK，并直接统计 update/pi 的生产源码覆盖率。 */
module.exports = {
    preset: 'ts-jest/presets/default-esm',
    testEnvironment: 'node',
    roots: ['<rootDir>/src', '<rootDir>/tests/live'],
    testMatch: ['**/*.test.mts'],
    moduleFileExtensions: ['mts', 'ts', 'js', 'mjs', 'cjs', 'json', 'node'],
    transform: {
        '^.+\\.m?tsx?$': [
            'ts-jest',
            {
                useESM: true,
                tsconfig: 'tsconfig.test.json',
            },
        ],
    },
    moduleNameMapper: {
        '^@/(.*)\\?raw$': '<rootDir>/tests/mocks/rawTextMock.ts',
        '^@util/(.*)$': '<rootDir>/util/$1',
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    collectCoverageFrom: ['src/function/update/pi/**/*.ts'],
    coverageDirectory: '<rootDir>/coverage/pi-live',
    coverageReporters: ['json', 'json-summary', 'text', 'lcov'],
};
