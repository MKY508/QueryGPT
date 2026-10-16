// Manual, read-only report fixture. No ReceiptBI backend, model, or user data.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const webDir = fileURLToPath(new URL('../', import.meta.url));
const webUrl = 'http://127.0.0.1:3148';
const rows = [{ 区域: '华东', 销售额: 128000 }, { 区域: '华南', 销售额: 96000 }, { 区域: '华北', 销售额: 72000 }];
function block(id, type, title, content, config = {}, width = 12) {
  return { id, block_type: type, title, content, config, layout: { x: 0, y: 0, w: width, h: 4 },
    order_index: 0, source_kind: 'manual', analysis_run_id: null, artifact_id: null, version: 1 };
}
const report = {
  id: 'smoke-report', project_id: 'smoke-project', title: '销售经营复盘', description: '演示数据 · 2026 年 8 月',
  status: 'draft', version: 1, created_at: '2026-09-05T00:00:00Z', updated_at: '2026-09-05T00:00:00Z',
  pages: [
    { id: 'overview', title: '区域概览', order_index: 0, version: 1, config: { narrative: '华东是本月销售的主要来源。' }, blocks: [
      block('region-filter', 'filter', '区域', {}, { field: '区域', operator: 'equals' }),
      block('sales-chart', 'chart', '各区域销售额', { rows }, { chart_type: 'bar', x_key: '区域', y_key: '销售额' }, 6),
      block('sales-note', 'text', '经营重点', { text: '关注主力区域的增长质量，并持续跟踪回款表现。' }, {}, 6),
      block('sales-table', 'table', '销售明细', { rows, rows_count: rows.length }),
    ] },
    { id: 'next-steps', title: '下月行动', order_index: 1, version: 1, config: {}, blocks: [
      block('next-note', 'text', '下一步', { text: '复核重点客户回款，整理新增订单。' }),
    ] },
  ],
};

const api = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.method !== 'GET') {
    response.writeHead(405);
    response.end(JSON.stringify({ error: 'This fixture is read-only.' }));
    return;
  }
  if (request.url === '/api/v1/projects/smoke-project/reports/smoke-report') {
    response.end(JSON.stringify({ data: report }));
  } else if (request.url === '/api/v1/projects/smoke-project/analysis-runs') {
    response.end(JSON.stringify({ data: [] }));
  } else {
    response.writeHead(404);
    response.end(JSON.stringify({ error: 'Not part of the report fixture.' }));
  }
});
await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3148'], {
  cwd: webDir, stdio: 'inherit', env: {
    ...process.env,
    NEXT_PUBLIC_API_URL: webUrl,
    INTERNAL_API_URL: `http://127.0.0.1:${api.address().port}`,
    RECEIPTBI_NEXT_DIST_DIR: '.next-report-image-smoke',
  },
});
console.log(`Manual report fixture: ${webUrl}/projects/smoke-project/reports/smoke-report`);
console.log('Choose a region, then export the current page as PNG. The fixture rejects writes.');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { child.kill(signal); api.close(); });
child.once('exit', (code) => { api.close(); process.exitCode = code ?? 0; });
