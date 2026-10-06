export type ClipboardListenerVisibility = {
  isFixture: boolean;
  moduleEnabled: boolean;
  hidden?: boolean;
  settingsOpen?: boolean;
};

export function clipboardListenerShouldRun({
  isFixture,
  moduleEnabled,
}: ClipboardListenerVisibility): boolean {
  return !isFixture && moduleEnabled;
}
