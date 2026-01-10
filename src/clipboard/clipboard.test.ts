import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mockSpawn,
  createSuccessfulChildProcess,
  createFailedChildProcess,
  createErrorChildProcess,
  createFallbackChildProcess,
} from '../test-utils/spawn-mocks';

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

const { getClipboardOperations, WindowsClipboard, LinuxClipboard } = await import('./index');

describe('getClipboardOperations', () => {
  const originalPlatform = process.platform;

  function setPlatform(platform: string): void {
    Object.defineProperty(process, 'platform', {
      value: platform,
    });
  }

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it('should return WindowsClipboard on win32', () => {
    setPlatform('win32');
    const clipboard = getClipboardOperations();
    expect(clipboard).toBeInstanceOf(WindowsClipboard);
  });

  it('should return LinuxClipboard on linux', () => {
    setPlatform('linux');
    const clipboard = getClipboardOperations();
    expect(clipboard).toBeInstanceOf(LinuxClipboard);
  });

  it('should throw error for unsupported platforms', () => {
    setPlatform('darwin');
    expect(() => getClipboardOperations()).toThrow('Plataforma não suportada: darwin');
  });

  it('should throw error for unknown platforms', () => {
    setPlatform('freebsd');
    expect(() => getClipboardOperations()).toThrow('Plataforma não suportada: freebsd');
  });
});

describe('WindowsClipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('simulatePaste', () => {
    it('should call powershell with correct paste command', async () => {
      mockSpawn.mockReturnValue(createSuccessfulChildProcess());

      const clipboard = new WindowsClipboard();
      await clipboard.simulatePaste();

      expect(mockSpawn).toHaveBeenCalledWith('powershell', [
        '-NoProfile',
        '-Command',
        expect.stringContaining("$wshell.SendKeys('^v')"),
      ]);
    });

    it('should reject on non-zero exit code', async () => {
      mockSpawn.mockReturnValue(createFailedChildProcess());

      const clipboard = new WindowsClipboard();
      await expect(clipboard.simulatePaste()).rejects.toThrow('SendKeys saiu com código 1');
    });

    it('should reject on spawn error', async () => {
      mockSpawn.mockReturnValue(createErrorChildProcess(new Error('Spawn failed')));

      const clipboard = new WindowsClipboard();
      await expect(clipboard.simulatePaste()).rejects.toThrow('Spawn failed');
    });
  });

  describe('simulateCopy', () => {
    it('should call powershell with correct copy command', async () => {
      mockSpawn.mockReturnValue(createSuccessfulChildProcess());

      const clipboard = new WindowsClipboard();
      await clipboard.simulateCopy();

      expect(mockSpawn).toHaveBeenCalledWith('powershell', [
        '-NoProfile',
        '-Command',
        expect.stringContaining("$wshell.SendKeys('^c')"),
      ]);
    });

    it('should reject on non-zero exit code', async () => {
      mockSpawn.mockReturnValue(createFailedChildProcess());

      const clipboard = new WindowsClipboard();
      await expect(clipboard.simulateCopy()).rejects.toThrow('SendKeys saiu com código 1');
    });
  });
});

describe('LinuxClipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('simulatePaste', () => {
    it('should try xdotool first', async () => {
      mockSpawn.mockReturnValue(createSuccessfulChildProcess());

      const clipboard = new LinuxClipboard();
      await clipboard.simulatePaste();

      expect(mockSpawn).toHaveBeenCalledWith('xdotool', ['key', '--clearmodifiers', 'ctrl+v']);
    });

    it('should fallback to ydotool when xdotool fails', async () => {
      mockSpawn.mockReturnValue(createFallbackChildProcess());

      const clipboard = new LinuxClipboard();
      await clipboard.simulatePaste();

      expect(mockSpawn).toHaveBeenCalledWith('ydotool', ['key', 'ctrl+v']);
    });

    it('should reject when both xdotool and ydotool fail', async () => {
      mockSpawn.mockReturnValue(createFailedChildProcess());

      const clipboard = new LinuxClipboard();
      await expect(clipboard.simulatePaste()).rejects.toThrow('ydotool saiu com código 1');
    });
  });

  describe('simulateCopy', () => {
    it('should try xdotool first', async () => {
      mockSpawn.mockReturnValue(createSuccessfulChildProcess());

      const clipboard = new LinuxClipboard();
      await clipboard.simulateCopy();

      expect(mockSpawn).toHaveBeenCalledWith('xdotool', ['key', '--clearmodifiers', 'ctrl+c']);
    });

    it('should fallback to ydotool when xdotool fails', async () => {
      mockSpawn.mockReturnValue(createFallbackChildProcess());

      const clipboard = new LinuxClipboard();
      await clipboard.simulateCopy();

      expect(mockSpawn).toHaveBeenCalledWith('ydotool', ['key', 'ctrl+c']);
    });
  });
});
