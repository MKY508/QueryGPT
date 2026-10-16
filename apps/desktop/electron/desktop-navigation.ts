export const DESKTOP_NAVIGATE_CHANNEL = 'desktop-navigate';
export const DESKTOP_NAVIGATION_READY_CHANNEL = 'desktop-navigation-ready';

export type DesktopPage = '/' | '/settings' | '/about';
export type DesktopLocale = 'zh' | 'en';

export function isDesktopPage(value: unknown): value is DesktopPage {
  return value === '/' || value === '/settings' || value === '/about';
}

export function desktopLocale(value: unknown): DesktopLocale {
  return typeof value === 'string' && value.toLowerCase().startsWith('en') ? 'en' : 'zh';
}
