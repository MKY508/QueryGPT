import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const desktopDir = fileURLToPath(new URL('../', import.meta.url));

execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.electron.json'], {
  cwd: desktopDir,
  stdio: 'inherit',
});

// Sandboxed Electron preloads cannot require local modules. Bundle all local
// code and let Electron provide the only external import at runtime.
await build({
  absWorkingDir: desktopDir,
  entryPoints: ['electron/preload.ts'],
  outfile: 'dist-electron/preload.js',
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  external: ['electron'],
  sourcemap: true,
});
