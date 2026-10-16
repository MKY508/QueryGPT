// Isolated UI fixture. All values are fictional. No database or model is used.
// Only GET is served; modifying actions are deliberately rejected.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const webDir = fileURLToPath(new URL('../', import.meta.url));
const webUrl = 'http://127.0.0.1:3152';
const projectId = 'workbench-demo';
const conversationId = 'd74f7238-64f7-4566-aec1-351105691620';
const now = '2026-09-06T02:24:00Z';
const project = { id: projectId, name: '门店经营', status: 'active', description: '界面演示 · 虚构数据', extra_data: {}, created_at: now, updated_at: now };
const rows = [{ 渠道: '直营', 营收: 82.2 }, { 渠道: '线上', 营收: 46.2 }];
const report = { status: 'completed', title: '营收增长，毛利率仍需关注',
  summary: '增长主要来自直营渠道；成本上升压低了毛利率。',
  primary_result: '增长主要来自直营渠道；成本上升压低了毛利率。',
  metrics: [{ label: '营收', value: '¥128.4万', context: '较 7 月增长 8.6%' }, { label: '毛利率', value: '32.6%', context: '较 7 月下降 2.6 个百分点' }],
  findings: [], evidence: ['订单明细.csv · 2026年8月 · 演示数据'], follow_ups: ['进一步看看各门店的毛利表现'],
  visualization: { type: 'horizontal_bar', title: '按销售渠道看营收', data: rows, x_key: '渠道', y_key: '营收' } };
const questions = ['各门店营收排行', '七月毛利率为什么下降？', '看看八月的经营表现'];
const reports = [
  { ...report, title: '旗舰店贡献了最多营收', summary: '门店之间的销售规模存在差异。', primary_result: '旗舰店贡献了最多营收。', metrics: [], visualization: null },
  { ...report, title: '配送成本上升，影响七月毛利', summary: '配送成本是毛利变化的主要因素。', primary_result: '配送成本是毛利变化的主要因素。', metrics: [], visualization: null }, report,
];
const runs = questions.map((query, index) => ({ id: `demo-run-${index}`, project_id: projectId, conversation_id: conversationId, query, state: 'completed', stage: 'completed', report: reports[index], checkpoint: {}, created_at: now, updated_at: now }));
const olderRuns = Array.from({ length: 23 }, (_, index) => ({
  ...runs[0], id: `history-run-${index + 1}`, conversation_id: `b24f7238-64f7-4566-aec1-${String(index + 1).padStart(12, '0')}`,
  query: `复盘第 ${index + 1} 周的门店经营`,
  report: { ...reports[0], title: `第 ${index + 1} 周门店经营`, summary: index === 22 ? '华东门店的配送费用需要复核。' : '营业收入与配送费用的周度复盘。' },
  state: index === 22 ? 'needs_attention' : 'completed',
  created_at: `2026-08-${String(23 - index).padStart(2, '0')}T02:24:00Z`,
  updated_at: `2026-08-${String(23 - index).padStart(2, '0')}T02:24:00Z`,
}));
function historyPage(params) {
  const all = [...runs, ...olderRuns].filter(run => params.get('purpose') !== 'report' || run.state === 'completed');
  const current = all.find(run => run.id === params.get('current_run_id'))?.id ?? null;
  const terms = (params.get('q') || '').normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
  const status = params.get('status') || 'all';
  const items = all.filter(run => (status === 'all' || (status === 'active' ? ['understanding', 'investigating'].includes(run.state) : run.state === status))
    && terms.every(term => [run.query, run.report.title, run.report.summary].join('\n').normalize('NFKC').toLowerCase().includes(term)))
    .sort((a, b) => Number(b.id === current) - Number(a.id === current) || b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
  const size = Math.min(50, Math.max(1, Number(params.get('page_size')) || 12));
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(pages, Math.max(1, Number(params.get('page')) || 1));
  return { items: items.slice((page - 1) * size, page * size).map(({ checkpoint: _checkpoint, error: _error, report: content, ...run }) =>
    ({ ...run, report: { title: content.title, summary: content.summary } })),
    total: all.length, count: items.length, page, page_size: size, page_count: pages, current_run_id: current };
}
const messages = questions.flatMap((query, index) => [
  { id: `user-${index}`, role: 'user', content: query, created_at: now },
  { id: `assistant-${index}`, role: 'assistant', content: reports[index].summary, created_at: now,
    metadata: { original_query: query, report: reports[index], data: index === 2 ? rows : [], analysis_state: 'completed', analysis_run_id: runs[index].id, project_id: projectId } },
]);
const source = { id: 'demo-orders', project_id: projectId, name: '订单明细.csv', kind: 'file', status: 'ready',
  created_at: now, updated_at: now, source_ref: 'demo-orders.csv',
  schema: { columns: [{ name: '渠道', type: 'VARCHAR' }, { name: '营收', type: 'DOUBLE' }] },
  profile_data: { row_count: 2480, file_type: 'csv', sample_rows: rows },
  extra_data: { row_count: 2480, file_type: 'csv', sample_rows: rows } };
const settings = { default_model_id: 'demo-model', context_rounds: 10, preprocessing_enabled: true, self_analysis_enabled: false, theme: 'dawn', language: 'zh' };
const reportBlock = (id, type, title, content, layout, config = {}) => ({ id, block_type: type, title, content, layout, config,
  order_index: layout.y, source_kind: 'manual', version: 1 });
const reportDocument = { id: 'demo-report', project_id: projectId, title: '八月门店经营月报',
  description: '营收持续增长，接下来重点关注渠道结构与各门店的毛利表现。', status: 'draft', version: 1,
  created_at: now, updated_at: now, extra_data: {}, pages: [
    { id: 'demo-page-overview', title: '经营概览', order_index: 0, version: 1, config: {}, blocks: [
      reportBlock('demo-revenue', 'metric', '营业收入', { value: '¥128.4万', context: '较 7 月增长 8.6%' }, { x: 0, y: 0, w: 6, h: 2 }),
      reportBlock('demo-margin', 'metric', '毛利率', { value: '32.6%', context: '较 7 月下降 2.6 个百分点' }, { x: 6, y: 0, w: 6, h: 2 }),
      reportBlock('demo-channels', 'chart', '渠道营收', { rows }, { x: 0, y: 2, w: 12, h: 4 }, { chart_type: 'horizontal_bar', x_key: '渠道', y_keys: ['营收'] }),
      reportBlock('demo-conclusion', 'text', '本月观察', { text: '直营渠道贡献了主要增长。下一步可以结合配送和促销费用，进一步比较门店间的毛利变化。' }, { x: 0, y: 6, w: 12, h: 2 }),
    ] },
    { id: 'demo-page-stores', title: '门店表现', order_index: 1, version: 1, config: {}, blocks: [
      reportBlock('demo-stores', 'table', '各门店收入', { rows: [{ 门店: '旗舰店', 营收: 58.4 }, { 门店: '城北店', 营收: 42.8 }, { 门店: '滨江店', 营收: 27.2 }] }, { x: 0, y: 0, w: 12, h: 5 }),
      reportBlock('demo-followup', 'text', '后续安排', { text: '重点复盘城北店与滨江店的毛利结构。' }, { x: 0, y: 5, w: 12, h: 2 }),
    ] },
    { id: 'demo-page-notes', title: '口径与说明', order_index: 2, version: 1, config: {}, blocks: [
      reportBlock('demo-notes', 'evidence', '统计口径', { text: '此预览使用虚构经营数据，仅用于检查报表编辑交互。' }, { x: 0, y: 0, w: 12, h: 3 }),
    ] },
  ] };
const routes = new Map([
  ['/api/v1/projects', [project]],
  ['/api/v1/settings', settings],
  ['/api/v1/config/models', [{ id: 'demo-model', name: '默认分析服务', provider: 'openai', model_name: 'demo', is_default: true, capabilities: ['chat'] }]],
  ['/api/v1/config/connections', []],
  [`/api/v1/projects/${projectId}/sources`, [source]],
  [`/api/v1/projects/${projectId}/analysis-runs`, runs],
  [`/api/v1/projects/${projectId}/knowledge/summary`, { active_total: 0, pending_total: 0, relationship_total: 0, confirmed_total: 0, locked_total: 0 }],
  [`/api/v1/projects/${projectId}/knowledge/page`, { items: [], total: 0, offset: 0, limit: 100 }],
  [`/api/v1/conversations/${conversationId}`, { id: conversationId, project_id: projectId, model_id: 'demo-model', title: '八月经营分析', messages }],
  [`/api/v1/projects/${projectId}/reports/demo-report`, reportDocument],
]);
for (const suffix of ['preflight', 'recipes', 'recipe-templates', 'standing-analyses', 'corrections', 'reports', 'reports/trash']) routes.set(`/api/v1/projects/${projectId}/${suffix}`, []);
for (const run of runs) routes.set(`/api/v1/projects/${projectId}/analysis-runs/${run.id}/artifacts`, []);
routes.set(`/api/v1/projects/${projectId}/analysis-runs/demo-run-2/artifacts`, [
  { id: 'picker-revenue', kind: 'metric', title: '八月营业收入', payload: { value: '¥128.4万', context: '较 7 月增长 8.6%' } },
  { id: 'picker-channel', kind: 'chart', title: '渠道收入分布', payload: { chart: report.visualization } },
  { id: 'picker-details', kind: 'table', title: '八月逐日明细', payload: { rows: Array.from({ length: 31 }, (_, index) => ({ 日期: `8月${index + 1}日`, 直营收入: '26000.25', 线上收入: '14600.75' })) } },
].map(artifact => ({ ...artifact, project_id: projectId, analysis_run_id: 'demo-run-2', technical_details: {}, created_at: now, updated_at: now })));
for (const run of olderRuns) {
  routes.set(`/api/v1/conversations/${run.conversation_id}`, { id: run.conversation_id, project_id: projectId,
    model_id: 'demo-model', title: run.report.title, messages: [
      { id: `${run.id}-question`, role: 'user', content: run.query, created_at: run.created_at },
      { id: `${run.id}-answer`, role: 'assistant', content: run.report.summary, created_at: run.created_at,
        metadata: { original_query: run.query, report: run.report, data: [], analysis_state: run.state, analysis_run_id: run.id, project_id: projectId } },
    ] });
  routes.set(`/api/v1/projects/${projectId}/analysis-runs/${run.id}/artifacts`, []);
}

for (const run of [...runs, ...olderRuns]) {
  const items = routes.get(`/api/v1/projects/${projectId}/analysis-runs/${run.id}/artifacts`) || [];
  const base = `/api/v1/projects/${projectId}/analysis-runs/${run.id}/report-artifacts`;
  routes.set(base, items.map(({ payload: _payload, technical_details: _details, ...summary }) => summary));
  for (const item of items) routes.set(`${base}/${item.id}`, { ...item, technical_details: {} });
}

const api = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.method !== 'GET') {
    response.writeHead(405);
    response.end(JSON.stringify({ detail: '演示预览不保存修改。' }));
    return;
  }
  const url = new URL(request.url, 'http://fixture');
  const path = url.pathname;
  if (path.includes('/report-artifacts')) {
    console.log(`Report content preview GET ${path}`);
    const item = routes.get(path);
    if (item && !Array.isArray(item) && url.searchParams.get('expected_updated_at') !== item.updated_at) {
      response.writeHead(409);
      response.end(JSON.stringify({ detail: '调查内容已有变化，请重新选择' }));
      return;
    }
  }
  if (path === `/api/v1/projects/${projectId}/analysis-history`) {
    response.end(JSON.stringify({ data: historyPage(url.searchParams) }));
    return;
  }
  if (routes.has(path)) response.end(JSON.stringify({ data: routes.get(path) }));
  else { response.writeHead(404); response.end(JSON.stringify({ detail: 'This route is not part of the UI fixture.' })); }
});
await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3152'], {
  cwd: webDir, stdio: 'inherit', env: { ...process.env, NEXT_PUBLIC_API_URL: webUrl,
    INTERNAL_API_URL: `http://127.0.0.1:${api.address().port}`, RECEIPTBI_NEXT_DIST_DIR: '.next-workbench-preview' },
});
console.log(`Isolated workbench preview: ${webUrl}/?conversation=${conversationId}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { child.kill(signal); api.close(); });
child.once('exit', (code) => { api.close(); process.exitCode = code ?? 0; });
