module.exports = {
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json',
    },
    Runtime: {
      getFunctions: () => null, // This is needed to mock Runtime.getFunctions()
    },
  },
  moduleFileExtensions: ['ts', 'js'],
  transform: {
    '^.+\\.(ts|tsx)$': './node_modules/ts-jest',
  },
  testMatch: ['**/tests/**/*.test.(ts|js)'],
  testEnvironment: 'node',
  preset: 'ts-jest', // use this if you are using TypeScript
};
