import { vi } from 'vitest';

interface MockChild {
  once: (event: string, callback: (arg?: unknown) => void) => void;
}

export const mockSpawn = vi.fn();

export function createSuccessfulChildProcess(): MockChild {
  return {
    once: vi.fn((event: string, callback: (arg?: unknown) => void) => {
      if (event === 'exit') {
        setTimeout(() => callback(0), 0);
      }
    }),
  };
}

export function createFailedChildProcess(exitCode = 1): MockChild {
  return {
    once: vi.fn((event: string, callback: (arg?: unknown) => void) => {
      if (event === 'exit') {
        setTimeout(() => callback(exitCode), 0);
      }
    }),
  };
}

export function createErrorChildProcess(error: Error): MockChild {
  return {
    once: vi.fn((event: string, callback: (arg?: unknown) => void) => {
      if (event === 'error') {
        setTimeout(() => callback(error), 0);
      }
    }),
  };
}

export function createFallbackChildProcess(): MockChild {
  let callCount = 0;
  return {
    once: vi.fn((event: string, callback: (arg?: unknown) => void) => {
      if (event === 'exit') {
        callCount++;
        const exitCode = callCount === 1 ? 1 : 0;
        setTimeout(() => callback(exitCode), 0);
      }
    }),
  };
}
