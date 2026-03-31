/**
 * Shim for build-time MACRO constants.
 * These are normally inlined by Bun's bundler at build time.
 */
declare global {
  const MACRO: {
    VERSION: string;
    PACKAGE_URL: string;
    NATIVE_PACKAGE_URL: string;
    BUILD_TIME: string;
    FEEDBACK_CHANNEL: string;
    ISSUES_EXPLAINER: string;
    VERSION_CHANGELOG: string;
  };
}

(globalThis as any).MACRO = {
  VERSION: '2.1.88',
  PACKAGE_URL: '@anthropic-ai/claude-code',
  NATIVE_PACKAGE_URL: '@anthropic-ai/claude-code-native',
  BUILD_TIME: new Date().toISOString(),
  FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues',
  ISSUES_EXPLAINER: 'Please report issues at https://github.com/anthropics/claude-code/issues',
  VERSION_CHANGELOG: '',
};

export {};
