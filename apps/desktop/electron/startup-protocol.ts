export const STARTUP_ACTION_CHANNEL = 'receiptbi:startup-action';

export type StartupAction = 'retry' | 'backups' | 'logs';
export type StartupActionResult = 'ok' | 'busy' | 'unavailable' | 'missing' | 'failed';

export function isStartupAction(value: unknown): value is StartupAction {
  return value === 'retry' || value === 'backups' || value === 'logs';
}
