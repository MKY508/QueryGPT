export const DESKTOP_CLOSE_REQUEST_CHANNEL = 'desktop-close-request';
export const DESKTOP_CLOSE_RESPONSE_CHANNEL = 'desktop-close-response';
export const DESKTOP_CLOSE_READY_CHANNEL = 'desktop-close-ready';

export type DesktopCloseCommand = 'inspect' | 'save' | 'discard' | 'cancel';
export type DesktopCloseState = 'clean' | 'dirty' | 'settings' | 'busy' | 'uploads' | 'unavailable';
export interface DesktopCloseRequest { id: string; command: DesktopCloseCommand }
export interface DesktopCloseResponse { id: string; state: DesktopCloseState }

export function isDesktopCloseState(value: unknown): value is DesktopCloseState {
  return value === 'clean' || value === 'dirty' || value === 'settings' || value === 'busy' || value === 'uploads' || value === 'unavailable';
}

function hasRequestId(value: unknown): value is { id: string } {
  return !!value && typeof value === 'object' && 'id' in value && typeof value.id === 'string'
    && /^[a-f0-9-]{36}$/.test(value.id);
}

export function isDesktopCloseRequest(value: unknown): value is DesktopCloseRequest {
  return hasRequestId(value) && 'command' in value && (value.command === 'inspect' || value.command === 'save' || value.command === 'discard' || value.command === 'cancel');
}

export function isDesktopCloseResponse(value: unknown): value is DesktopCloseResponse {
  return hasRequestId(value) && 'state' in value && isDesktopCloseState(value.state);
}
