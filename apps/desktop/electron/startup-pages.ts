import { createHash } from 'node:crypto';
import type { DesktopLocale } from './desktop-navigation.js';

const messages = {
  zh: {
    lang: 'zh-CN', eyebrow: '分析工作台', loading: '正在打开 ReceiptBI',
    waiting: '稍候片刻。更新后的首次打开可能需要更长时间。',
    failed: 'ReceiptBI 暂时无法启动', startup: '可以重新尝试打开。如果仍然失败，可以查看日志。',
    assets: '界面未能加载完成。请重新尝试打开。', retry: '重新尝试',
    quit: '关闭 ReceiptBI', backups: '打开备份文件夹', logs: '打开日志文件夹',
    missingBackups: '尚未找到升级前备份。', missingLogs: '尚未找到日志文件夹。',
    actionFailed: '未能完成操作，请稍后重试。', unavailable: '当前无法操作，请关闭后重新打开 ReceiptBI。',
  },
  en: {
    lang: 'en', eyebrow: 'Analysis workspace', loading: 'Opening ReceiptBI',
    waiting: 'One moment. The first launch after an update may take longer.',
    failed: 'ReceiptBI could not open', startup: 'Try opening again. If the problem continues, you can check the logs.',
    assets: 'The interface did not finish loading. Please try again.', retry: 'Try again',
    quit: 'Quit ReceiptBI', backups: 'Open backups folder', logs: 'Open logs folder',
    missingBackups: 'No pre-upgrade backup was found.', missingLogs: 'No logs folder was found.',
    actionFailed: 'The action could not be completed. Please try again.', unavailable: 'This action is unavailable. Quit and reopen ReceiptBI.',
  },
};

const styles = `
  :root { color-scheme:light dark; font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
    --background:hsl(60 14% 98%); --foreground:hsl(160 35% 14%); --muted:hsl(160 12% 42%);
    --border:hsl(150 12% 88%); --primary:hsl(158 42% 26%); --on-primary:hsl(60 14% 98%); --warning:hsl(34 62% 40%); }
  @media (prefers-color-scheme:dark) { :root { --background:hsl(160 20% 8%); --foreground:hsl(150 15% 92%);
    --muted:hsl(150 10% 58%); --border:hsl(160 12% 20%); --primary:hsl(158 38% 42%);
    --on-primary:hsl(160 20% 8%); --warning:hsl(38 78% 66%); } }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; background:var(--background); color:var(--foreground); }
  .shell { min-height:100vh; display:grid; grid-template-rows:auto 1fr; padding:42px 52px; }
  .brand { display:flex; align-items:center; gap:13px; color:var(--muted); font-size:13px; font-weight:700; letter-spacing:.08em; }
  .mark { width:34px; height:34px; object-fit:contain; }
  .content { align-self:center; width:min(680px,100%); margin-left:8vw; border-left:4px solid var(--primary); padding:4px 0 4px 34px; }
  .error { border-color:var(--warning); }
  .eyebrow { margin:0 0 22px; color:var(--primary); font-size:12px; font-weight:700; letter-spacing:.12em; }
  h1 { margin:0; font-size:clamp(34px,5vw,54px); line-height:1.15; letter-spacing:-.035em; }
  .copy { margin:22px 0 0; max-width:590px; color:var(--muted); font-size:16px; line-height:1.75; }
  .actions { display:flex; flex-wrap:wrap; gap:12px; margin-top:28px; }
  .secondary { margin-top:16px; }
  button { min-height:42px; padding:8px 18px; border:1px solid var(--border); border-radius:6px;
    background:transparent; color:var(--foreground); font:inherit; cursor:pointer; }
  .primary { border-color:var(--primary); background:var(--primary); color:var(--on-primary); font-weight:600; }
  .secondary button { border-color:transparent; padding:4px 0; min-height:32px; margin-right:18px; color:var(--muted); font-size:13px; }
  button:hover { text-decoration:underline; text-underline-offset:3px; }
  button:focus-visible { outline:3px solid var(--primary); outline-offset:3px; }
  button:disabled { opacity:.55; cursor:wait; }
  .notice { min-height:24px; margin:12px 0 0; color:var(--muted); line-height:1.5; font-size:14px; }
  .pulse { width:7px; height:7px; margin-top:30px; background:var(--primary); border-radius:50%; animation:pulse 1.6s ease-in-out infinite alternate; }
  @keyframes pulse { to { opacity:.3; } }
  @media (max-width:900px) { .content { margin-left:0; } }
  @media (max-width:720px) { .shell { padding:32px; } .content { padding-left:24px; } }
  @media (prefers-reduced-motion:reduce) { .pulse { animation:none; } }
`;

export interface StartupPages { loading: string; error: string; assetsError: string }

export function createStartupPages(iconDataUrl: string | null, locale: DesktopLocale): StartupPages {
  const m = messages[locale];
  // Only internally generated PNG data can be interpolated into this document.
  const mark = iconDataUrl && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(iconDataUrl)
    ? `<img class="mark" src="${iconDataUrl}" alt="" aria-hidden="true">` : '';
  const script = `
    const messages = ${JSON.stringify(m)};
    const buttons = Array.from(document.querySelectorAll('[data-action]'));
    const notice = document.getElementById('notice');
    document.getElementById('quit').addEventListener('click', () => window.electronAPI?.quitApp?.());
    buttons.forEach(button => button.addEventListener('click', async () => {
      if (buttons.some(item => item.disabled)) return;
      buttons.forEach(item => item.disabled = true);
      notice.textContent = '';
      try {
        const result = await window.electronAPI?.startupAction?.(button.dataset.action);
        if (result === 'missing') notice.textContent = button.dataset.action === 'backups' ? messages.missingBackups : messages.missingLogs;
        else if (result !== 'ok') notice.textContent = result === 'unavailable' ? messages.unavailable : messages.actionFailed;
      } catch { notice.textContent = messages.actionFailed; }
      finally { buttons.forEach(item => item.disabled = false); }
    }));
  `;
  const scriptHash = createHash('sha256').update(script).digest('base64');
  const page = (error: boolean, copy: string): string => {
    const csp = `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src ${error ? `'sha256-${scriptHash}'` : "'none'"}; base-uri 'none'; form-action 'none'`;
    return `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html lang="${m.lang}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="color-scheme" content="light dark"><title>${error ? m.failed : 'ReceiptBI'}</title><style>${styles}</style></head>
<body><main class="shell"><header class="brand">${mark}<span>RECEIPTBI</span></header>
<section class="content${error ? ' error' : ''}"${error ? '' : ' role="status" aria-live="polite"'}>
<p class="eyebrow">${m.eyebrow}</p><h1>${error ? m.failed : m.loading}</h1><p class="copy">${copy}</p>
${error ? `<div class="actions"><button class="primary" data-action="retry" type="button">${m.retry}</button><button id="quit" type="button">${m.quit}</button></div>
<div class="secondary"><button data-action="backups" type="button">${m.backups}</button><button data-action="logs" type="button">${m.logs}</button></div>
<p id="notice" class="notice" role="status" aria-live="polite"></p>` : '<div class="pulse" aria-hidden="true"></div>'}
</section></main>${error ? `<script>${script}</script>` : ''}</body></html>`)}`;
  };
  return { loading: page(false, m.waiting), error: page(true, m.startup), assetsError: page(true, m.assets) };
}
