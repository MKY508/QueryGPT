import type { BrowserWindow, IpcMainEvent, WebContents } from 'electron';

export interface DesktopWindowPolicy {
  frontendUrl: string;
  startupUrls: ReadonlySet<string>;
}

const trustedWindows = new WeakMap<WebContents, DesktopWindowPolicy>();

export function isFrontendUrl(value: string, frontendUrl: string): boolean {
  try {
    const candidate = new URL(value);
    const frontend = new URL(frontendUrl);
    return (candidate.protocol === 'http:' || candidate.protocol === 'https:')
      && !candidate.username && !candidate.password
      && candidate.origin === frontend.origin;
  } catch {
    return false;
  }
}

export function externalWebUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function isTrustedDesktopSender(
  event: Pick<IpcMainEvent, 'sender' | 'senderFrame'>,
  allowStartup = false,
): boolean {
  const policy = trustedWindows.get(event.sender);
  if (!policy || event.sender.isDestroyed()) return false;
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) return false;
  return isFrontendUrl(frame.url, policy.frontendUrl)
    || (allowStartup && policy.startupUrls.has(frame.url));
}

/** Keep links in their proper application and the desktop bridge in our window. */
export function configureDesktopWindow(
  win: BrowserWindow,
  policy: DesktopWindowPolicy,
  openExternal: (url: string) => Promise<unknown>,
  onError: (error: unknown) => void,
): void {
  const contents = win.webContents;
  trustedWindows.set(contents, policy);
  contents.once('destroyed', () => trustedWindows.delete(contents));

  const openWebLink = (value: string): void => {
    const url = externalWebUrl(value);
    if (url) void openExternal(url).catch(onError);
  };

  contents.on('will-navigate', (event, url) => {
    if (isFrontendUrl(url, policy.frontendUrl)) return;
    event.preventDefault();
    openWebLink(url);
  });
  contents.on('will-redirect', (event, url) => {
    if (!isFrontendUrl(url, policy.frontendUrl)) event.preventDefault();
  });
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && !isFrontendUrl(event.url, policy.frontendUrl)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (isFrontendUrl(url, policy.frontendUrl)) {
      void win.loadURL(url).catch(onError);
    } else {
      openWebLink(url);
    }
    return { action: 'deny' };
  });
}
