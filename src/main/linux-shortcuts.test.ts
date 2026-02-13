import { describe, expect, it, vi } from 'vitest';
import { configureLinuxGlobalShortcuts } from './linux-shortcuts';

describe('configureLinuxGlobalShortcuts', () => {
  it('enables GlobalShortcutsPortal on linux', () => {
    const appendSwitch = vi.fn();

    configureLinuxGlobalShortcuts({ commandLine: { appendSwitch } } as never, 'linux');

    expect(appendSwitch).toHaveBeenCalledWith('enable-features', 'GlobalShortcutsPortal');
  });

  it('does nothing outside linux', () => {
    const appendSwitch = vi.fn();

    configureLinuxGlobalShortcuts({ commandLine: { appendSwitch } } as never, 'darwin');

    expect(appendSwitch).not.toHaveBeenCalled();
  });
});
