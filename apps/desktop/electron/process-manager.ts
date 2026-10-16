import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { app, utilityProcess, type UtilityProcess } from 'electron';
import type { Logger } from './logger.js';
import type { DesktopDataPaths } from './data-migration.js';
import {
  markLegacyModelMigrationImported,
  prepareLegacyModelMigration,
  validateLegacyModelMigrationAck,
  type LegacyModelMigrationPreparation,
} from './legacy-model-migration.js';
import { validateFrontendBundle } from './frontend-bundle.js';
import { BACKEND_READY_TIMEOUT_MS, FRONTEND_READY_TIMEOUT_MS, waitForServiceReady } from './service-readiness.js';
import {
  extractNextStaticScriptUrls,
  isHtmlContentType,
  isJavaScriptContentType,
} from './frontend-reliability.js';

export interface ServiceStatus {
  name: string;
  running: boolean;
  pid?: number;
  url?: string;
  error?: string;
}

type ServiceName = 'backend' | 'frontend';

interface OwnedProcess {
  readonly child: ChildProcess | UtilityProcess;
  readonly name: ServiceName;
  readonly kind: 'child' | 'utility';
  readonly exitPromise: Promise<void>;
  exited: boolean;
}

interface BackendHealthPayload {
  readonly instance_token?: unknown;
  readonly legacy_model_migration?: unknown;
}

type ReadyLegacyModelMigration = Extract<
  LegacyModelMigrationPreparation,
  { readonly status: 'ready' }
>;

// 固定端口
const BACKEND_PORT = 18080;
const FRONTEND_PORT = 13000;

export class ProcessManager {
  private backendProcess: OwnedProcess | null = null;
  private frontendProcess: OwnedProcess | null = null;
  private backendReady = false;
  private frontendReady = false;
  private backendError: string | undefined;
  private frontendError: string | undefined;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private lifecycleGeneration = 0;
  private readonly logger: Logger;
  private readonly baseDir: string;
  private readonly userDataDir: string;
  private readonly dataDir: string;
  private readonly databasePath: string;
  private readonly instanceToken = randomBytes(24).toString('hex');
  private readonly desktopControlToken = randomBytes(32).toString('hex');
  private pendingLegacyModelMigration: ReadyLegacyModelMigration | null = null;

  constructor(logger: Logger, dataPaths: DesktopDataPaths) {
    this.logger = logger;
    this.baseDir = this.getResourceBaseDir();
    this.userDataDir = dataPaths.userDataDir;
    this.dataDir = dataPaths.dataDir;
    this.databasePath = dataPaths.databasePath;
  }

  private getResourceBaseDir(): string {
    if (!app.isPackaged) {
      return path.resolve(__dirname, '../../..');
    }
    return path.join(process.resourcesPath);
  }

  private getApiDir(): string {
    return path.join(this.baseDir, 'apps', 'api');
  }

  private getWebDir(): string {
    return path.join(this.baseDir, 'apps', 'web');
  }

  private getBackendOutDir(): string {
    return path.join(this.baseDir, 'backend');
  }

  private getNextOutDir(): string {
    return path.join(this.baseDir, 'next');
  }

  private isValidEncryptionKey(value: string): boolean {
    if (!/^[A-Za-z0-9_-]{43}=$/.test(value)) return false;
    const decoded = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return decoded.length === 32;
  }

  private readLegacyEncryptionKey(): string | null {
    const envPath = path.join(this.userDataDir, '.env');
    if (!fs.existsSync(envPath)) return null;

    let candidate: string | null = null;
    for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?ENCRYPTION_KEY\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      let value = match[1].trim();
      const quote = value[0];
      if (quote === '"' || quote === "'") {
        const closingQuote = value.indexOf(quote, 1);
        if (closingQuote >= 1) value = value.slice(1, closingQuote);
      } else {
        value = value.split('#', 1)[0].trim();
      }
      if (this.isValidEncryptionKey(value)) candidate = value;
    }
    return candidate;
  }

  private ensureEncryptionKey(): string {
    const keyPath = path.join(this.userDataDir, 'encryption.key');
    if (fs.existsSync(keyPath)) {
      const existing = fs.readFileSync(keyPath, 'utf-8').trim();
      if (!this.isValidEncryptionKey(existing)) {
        throw new Error(`Desktop encryption key is invalid: ${keyPath}`);
      }
      if (process.platform !== 'win32') fs.chmodSync(keyPath, 0o600);
      return existing;
    }

    const legacyKey = this.readLegacyEncryptionKey();
    const generated =
      legacyKey ??
      randomBytes(32)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    const temporary = `${keyPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${generated}\n`, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(temporary, keyPath);
    this.logger.info(
      legacyKey
        ? 'Preserved the existing desktop encryption key'
        : 'Created a private desktop encryption key'
    );
    return generated;
  }

  private prepareLegacyModelImport(): NodeJS.ProcessEnv {
    const preparation = prepareLegacyModelMigration(this.userDataDir);

    if (preparation.status === 'imported') {
      // The model transaction was acknowledged on an earlier launch. Keep the
      // active historical files untouched: without cooperation from the old
      // process, automatic deletion cannot exclude a concurrent SQLite writer.
      this.pendingLegacyModelMigration = null;
      return {};
    }

    if (preparation.status !== 'ready') {
      this.pendingLegacyModelMigration = null;
      return {};
    }

    this.pendingLegacyModelMigration = preparation;
    const migrationEnvironment: NodeJS.ProcessEnv = {
      RECEIPTBI_LEGACY_MODEL_SNAPSHOT: preparation.databaseSnapshotPath,
      RECEIPTBI_LEGACY_MODEL_ROOT: this.userDataDir,
    };
    if (preparation.databaseSourcePath !== null) {
      migrationEnvironment.RECEIPTBI_LEGACY_MODEL_SOURCE =
        preparation.databaseSourcePath;
    }
    if (preparation.legacyEncryptionKey !== null) {
      migrationEnvironment.RECEIPTBI_LEGACY_MODEL_ENCRYPTION_KEY =
        preparation.legacyEncryptionKey;
    }
    return migrationEnvironment;
  }

  private async assertPortAvailable(port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const server = createServer();
      server.unref();
      server.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} is already in use; ReceiptBI did not stop that process`));
          return;
        }
        reject(error);
      });
      server.listen(port, '127.0.0.1', () => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    });
  }

  private ownProcess(
    child: ChildProcess | UtilityProcess,
    name: ServiceName,
    kind: OwnedProcess['kind']
  ): OwnedProcess {
    let resolveExit!: () => void;
    const owned: OwnedProcess = {
      child,
      name,
      kind,
      exited: false,
      exitPromise: new Promise<void>((resolve) => {
        resolveExit = resolve;
      }),
    };

    const markExited = (code: number | null): void => {
      if (owned.exited) return;
      owned.exited = true;
      resolveExit();

      if (name === 'backend') {
        this.backendReady = false;
        if (this.backendProcess === owned) this.backendProcess = null;
      } else {
        this.frontendReady = false;
        if (this.frontendProcess === owned) this.frontendProcess = null;
      }

      if (code !== 0 && code !== null) {
        this.logger.warn(`${name === 'backend' ? 'Backend' : 'Frontend'} exited with code ${code}`);
      }
    };

    if (kind === 'utility') {
      (child as UtilityProcess).once('exit', markExited);
    } else {
      // "close" also fires after a spawn error, while "exit" does not necessarily do so.
      (child as ChildProcess).once('close', markExited);
    }

    return owned;
  }

  startAll(): Promise<void> {
    if (this.isReady()) return Promise.resolve();
    if (this.startPromise) return this.startPromise;

    const pendingStop =
      this.stopPromise ??
      (this.backendProcess || this.frontendProcess ? this.stopAll() : Promise.resolve());
    // Allocate the generation synchronously so an immediate stopAll() cancels this start.
    const generation = ++this.lifecycleGeneration;
    const startPromise = pendingStop.then(() => this.doStartAll(generation));
    this.startPromise = startPromise;
    startPromise.then(
      () => {
        if (this.startPromise === startPromise) this.startPromise = null;
      },
      () => {
        if (this.startPromise === startPromise) this.startPromise = null;
      }
    );
    return startPromise;
  }

  private async doStartAll(generation: number): Promise<void> {
    if (generation !== this.lifecycleGeneration) throw new Error('Service startup was cancelled');
    if (this.backendProcess || this.frontendProcess) {
      throw new Error('Previously owned services did not stop');
    }

    this.backendReady = false;
    this.frontendReady = false;
    this.backendError = undefined;
    this.frontendError = undefined;

    fs.mkdirSync(this.userDataDir, { recursive: true });
    fs.mkdirSync(path.join(this.userDataDir, 'logs'), { recursive: true });
    fs.mkdirSync(this.dataDir, { recursive: true });

    // A port owned by another app is a startup error, never a reason to kill it.
    await this.assertPortAvailable(BACKEND_PORT);
    await this.assertPortAvailable(FRONTEND_PORT);
    if (generation !== this.lifecycleGeneration) throw new Error('Service startup was cancelled');

    // Start only after ruling out another service owner on the control ports.
    try {
      this.startBackend();
      if (generation !== this.lifecycleGeneration) throw new Error('Service startup was cancelled');
      this.startFrontend();
      await this.waitForServices(generation);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.backendReady) this.backendError = message;
      if (!this.frontendReady) this.frontendError = message;
      this.pendingLegacyModelMigration = null;
      await this.stopAll();
      throw error;
    }
  }

  private startBackend(): void {
    const apiDir = this.getApiDir();
    const backendDir = this.getBackendOutDir();
    const isPacked = app.isPackaged;

    let exePath: string;
    let args: string[] = [];
    let cwd: string;

    if (isPacked) {
      const exeName = process.platform === 'win32' ? 'receiptbi-api.exe' : 'receiptbi-api';
      exePath = path.join(backendDir, exeName);
      cwd = backendDir;
      if (!fs.existsSync(exePath)) {
        throw new Error(`Backend executable not found: ${exePath}`);
      }
    } else {
      cwd = apiDir;
      const pythonRelativePath = process.platform === 'win32'
        ? path.join('Scripts', 'python.exe')
        : path.join('bin', 'python');
      const candidates = [
        path.join(this.baseDir, '.venv', pythonRelativePath),
        path.join(apiDir, '.venv', pythonRelativePath),
      ];
      exePath = candidates.find((candidate) => fs.existsSync(candidate)) ?? '';
      if (!exePath) {
        throw new Error(
          `ReceiptBI Python environment is not installed. Expected one of: ${candidates.join(', ')}`
        );
      }
      args = ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)];
    }

    this.logger.info(`Starting backend: ${exePath} ${args.join(' ')}`);

    const encryptionKey = this.ensureEncryptionKey();
    const legacyModelEnvironment = this.prepareLegacyModelImport();

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      APP_NAME: 'ReceiptBI',
      HOST: '127.0.0.1',
      PORT: String(BACKEND_PORT),
      ENVIRONMENT: app.isPackaged ? 'production' : 'development',
      CORS_ORIGINS_STR: `http://127.0.0.1:${FRONTEND_PORT},http://localhost:${FRONTEND_PORT}`,
      DATA_DIR: this.dataDir,
      WORKSPACE_ROOT: path.join(this.dataDir, 'projects'),
      DATABASE_URL: `sqlite+aiosqlite:///${this.databasePath}`,
      RECEIPTBI_ENV_FILE: path.join(this.userDataDir, '.env'),
      RECEIPTBI_INSTANCE_TOKEN: this.instanceToken,
      RECEIPTBI_DESKTOP_CONTROL_TOKEN: this.desktopControlToken,
      ENCRYPTION_KEY: encryptionKey,
      ...legacyModelEnvironment,
    };

    const sqliteSidecarName = process.platform === 'win32'
      ? 'receiptbi-sqlite-executor-sidecar.exe'
      : 'receiptbi-sqlite-executor-sidecar';
    const sqliteSidecarPath = path.join(backendDir, sqliteSidecarName);
    if (app.isPackaged && !fs.existsSync(sqliteSidecarPath)) {
      throw new Error(`Trusted SQLite executor not found: ${sqliteSidecarPath}`);
    }
    if (fs.existsSync(sqliteSidecarPath)) {
      env.RECEIPTBI_SQLITE_EXECUTOR_PATH = sqliteSidecarPath;
    }

    if (isPacked && process.platform === 'linux') {
      (env as NodeJS.ProcessEnv).MPLBACKEND = 'Agg';
    }

    const backend = spawn(exePath, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    this.backendProcess = this.ownProcess(backend, 'backend', 'child');

    backend.stdout?.on('data', (data) => {
      this.logger.debug(`[Backend] ${data.toString().trim()}`);
    });

    backend.stderr?.on('data', (data) => {
      this.logger.debug(`[Backend] ${data.toString().trim()}`);
    });

    backend.on('error', (error) => {
      this.backendError = error.message;
      this.logger.error('Backend process error', error);
    });
  }

  private startFrontend(): void {
    const webDir = this.getWebDir();
    const nextDir = this.getNextOutDir();
    const serverJs = path.join(nextDir, 'server.js');

    const env: Record<string, string> = {
      NEXT_PUBLIC_API_URL: `http://127.0.0.1:${BACKEND_PORT}`,
      PORT: String(FRONTEND_PORT),
      HOSTNAME: '127.0.0.1',
      NODE_ENV: app.isPackaged ? 'production' : 'development',
    };

    if (app.isPackaged) {
      let frontendBuild;
      try {
        frontendBuild = validateFrontendBundle(nextDir);
      } catch (error) {
        throw new Error('Packaged ReceiptBI frontend is incomplete or unverified', {
          cause: error,
        });
      }
      this.logger.info(
        `Starting frontend build ${frontendBuild.buildId} (utilityProcess): ${serverJs}`
      );
      const up = utilityProcess.fork(serverJs, [], {
        cwd: nextDir,
        env: { ...process.env, ...env },
        stdio: 'pipe',
      });
      up.stdout?.on('data', (data: Buffer) => {
        this.logger.debug(`[Frontend] ${data.toString().trim()}`);
      });
      up.stderr?.on('data', (data: Buffer) => {
        this.logger.debug(`[Frontend] ${data.toString().trim()}`);
      });
      up.on('error', (type, location) => {
        this.frontendError = `${type} at ${location}`;
        this.logger.error('Frontend utility process error', type, location);
      });
      this.frontendProcess = this.ownProcess(up, 'frontend', 'utility');
    } else {
      // Source development must always render the current workspace. A stale
      // standalone bundle may exist from an earlier packaging run, but it is
      // never authoritative outside a packaged application.
      const nextExe = path.join(
        webDir,
        'node_modules',
        '.bin',
        process.platform === 'win32' ? 'next.cmd' : 'next'
      );
      if (!fs.existsSync(nextExe)) {
        throw new Error(`ReceiptBI web dependencies are not installed: ${nextExe}`);
      }
      this.logger.info('Starting frontend (source mode): next dev');

      const devProc = spawn(
        nextExe,
        ['dev', '--hostname', '127.0.0.1', '--port', String(FRONTEND_PORT)],
        {
          cwd: webDir,
          env: { ...process.env, ...env },
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
        }
      );

      devProc.stdout?.on('data', (data) => {
        this.logger.debug(`[Frontend] ${data.toString().trim()}`);
      });
      devProc.stderr?.on('data', (data) => {
        this.logger.debug(`[Frontend] ${data.toString().trim()}`);
      });
      devProc.on('error', (error) => {
        this.frontendError = error.message;
        this.logger.error('Frontend process error', error);
      });
      this.frontendProcess = this.ownProcess(devProc, 'frontend', 'child');
    }
  }

  private async waitForServices(generation: number): Promise<void> {
    const http = await import('node:http');
    const backend = this.backendProcess;
    const frontend = this.frontendProcess;
    if (!backend || !frontend) throw new Error('Services were not started');

    const backendHealth = await this.waitForService(
      backend,
      frontend,
      generation,
      BACKEND_READY_TIMEOUT_MS,
      (signal) =>
        this.checkHttp(
          `http://127.0.0.1:${BACKEND_PORT}/health`,
          http,
          this.instanceToken,
          signal
        )
    );
    this.acknowledgePendingLegacyModelMigration(backendHealth);
    this.backendReady = true;
    this.logger.info('Backend is ready');

    await this.waitForService(
      frontend,
      backend,
      generation,
      FRONTEND_READY_TIMEOUT_MS,
      (signal) => this.checkFrontendReady(`http://127.0.0.1:${FRONTEND_PORT}`, http, signal)
    );
    this.frontendReady = true;
    this.logger.info('Frontend is ready');

    if (!app.isPackaged) {
      const warmup = setTimeout(() => {
        if (generation !== this.lifecycleGeneration || frontend.exited) return;
        void this.checkHttp(`http://127.0.0.1:${FRONTEND_PORT}/settings`, http)
          .then(() => this.logger.debug('Settings route is warm'))
          .catch((error) => {
            this.logger.debug(`Settings route warmup skipped: ${String(error)}`);
          });
      }, 750);
      warmup.unref();
    }
  }

  private async waitForService<T>(
    owned: OwnedProcess,
    peer: OwnedProcess,
    generation: number,
    timeoutMs: number,
    readinessCheck: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    return waitForServiceReady({
      name: owned.name,
      timeoutMs,
      exited: Promise.race([owned.exitPromise, peer.exitPromise]),
      assertActive: () => {
        if (generation !== this.lifecycleGeneration) throw new Error('Service startup was cancelled');
        if (owned.exited) throw new Error(`${owned.name} exited before becoming ready`);
        if (peer.exited) throw new Error(`${peer.name} exited during service startup`);
      },
      check: readinessCheck,
    });
  }

  private checkHttp(
    url: string,
    http: typeof import('node:http'),
    expectedInstanceToken?: string,
    signal?: AbortSignal
  ): Promise<BackendHealthPayload | undefined> {
    return new Promise((resolve, reject) => {
      const req = http.get(url, { signal }, (response) => {
        response.on('error', reject);
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }

        if (!expectedInstanceToken) {
          response.resume();
          resolve(undefined);
          return;
        }

        let body = '';
        let settled = false;
        response.setEncoding('utf-8');
        response.on('data', (chunk: string) => {
          if (settled) return;
          body += chunk;
          if (body.length > 64 * 1024) {
            settled = true;
            response.destroy();
            reject(new Error('Health response was too large'));
          }
        });
        response.on('end', () => {
          if (settled) return;
          try {
            const payload = JSON.parse(body) as BackendHealthPayload;
            if (payload.instance_token !== expectedInstanceToken) {
              reject(new Error('Health response came from a different ReceiptBI instance'));
              return;
            }
            resolve(payload);
          } catch (error) {
            reject(new Error('Health response was not valid JSON', { cause: error }));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(2000, () => req.destroy(new Error('Timeout')));
    });
  }

  private readHttpText(
    url: string,
    http: typeof import('node:http'),
    maxBytes: number,
    signal?: AbortSignal
  ): Promise<{ body: string; contentType: string | string[] | undefined }> {
    return new Promise((resolve, reject) => {
      const req = http.get(url, { signal }, (response) => {
        response.on('error', reject);
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }

        let body = '';
        let settled = false;
        response.setEncoding('utf-8');
        response.on('data', (chunk: string) => {
          if (settled) return;
          body += chunk;
          if (Buffer.byteLength(body, 'utf-8') > maxBytes) {
            settled = true;
            response.destroy();
            reject(new Error(`HTTP response exceeded ${maxBytes} bytes`));
          }
        });
        response.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({ body, contentType: response.headers['content-type'] });
        });
        response.on('error', (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('Timeout')));
    });
  }

  private checkStaticJavaScript(
    url: string,
    http: typeof import('node:http'),
    signal?: AbortSignal
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = http.get(url, { signal }, (response) => {
        response.on('error', reject);
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`Static asset returned HTTP ${status}: ${url}`));
          return;
        }
        if (!isJavaScriptContentType(response.headers['content-type'])) {
          response.resume();
          reject(new Error(`Static asset was not JavaScript: ${url}`));
          return;
        }

        let receivedContent = false;
        response.on('data', (chunk: Buffer) => {
          if (chunk.length > 0) receivedContent = true;
        });
        response.on('end', () => {
          if (!receivedContent) {
            reject(new Error(`Static asset was empty: ${url}`));
            return;
          }
          resolve();
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('Timeout')));
    });
  }

  private async checkFrontendReady(
    url: string,
    http: typeof import('node:http'),
    signal?: AbortSignal
  ): Promise<void> {
    const { body, contentType } = await this.readHttpText(url, http, 1024 * 1024, signal);
    if (!isHtmlContentType(contentType) || !/<html(?:\s|>)/i.test(body)) {
      throw new Error('Frontend root did not return an HTML document');
    }

    const scriptUrls = extractNextStaticScriptUrls(body, url);
    if (scriptUrls.length === 0) {
      throw new Error('Frontend HTML did not reference any Next.js JavaScript chunks');
    }
    if (scriptUrls.length > 32) {
      throw new Error(`Frontend HTML referenced too many JavaScript chunks: ${scriptUrls.length}`);
    }

    await Promise.all(scriptUrls.map((scriptUrl) => this.checkStaticJavaScript(scriptUrl, http, signal)));
  }

  private acknowledgePendingLegacyModelMigration(
    health: BackendHealthPayload | undefined
  ): void {
    const pending = this.pendingLegacyModelMigration;
    if (!pending) return;

    validateLegacyModelMigrationAck(
      health?.legacy_model_migration,
      this.instanceToken
    );

    markLegacyModelMigrationImported(this.userDataDir, pending.migrationId);
    this.pendingLegacyModelMigration = null;
    this.logger.info('Migrated the legacy model configuration and retained its legacy sources');
  }

  stopAll(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;

    ++this.lifecycleGeneration;
    const stopPromise = this.doStopAll();
    this.stopPromise = stopPromise;
    stopPromise.then(
      () => {
        if (this.stopPromise === stopPromise) this.stopPromise = null;
      },
      () => {
        if (this.stopPromise === stopPromise) this.stopPromise = null;
      }
    );
    return stopPromise;
  }

  private async doStopAll(): Promise<void> {
    this.logger.info('Stopping all services...');

    const frontend = this.frontendProcess;
    const backend = this.backendProcess;
    if (backend && this.backendReady && !backend.exited) {
      await this.prepareBackendShutdown();
    }

    this.backendReady = false;
    this.frontendReady = false;
    await Promise.all([
      frontend ? this.stopOwnedProcess(frontend) : Promise.resolve(),
      backend ? this.stopOwnedProcess(backend) : Promise.resolve(),
    ]);

    if (frontend?.exited && this.frontendProcess === frontend) {
      this.frontendProcess = null;
    }
    if (backend?.exited && this.backendProcess === backend) {
      this.backendProcess = null;
    }

    if (this.frontendProcess || this.backendProcess) {
      this.logger.warn('Some owned services did not exit after being force-killed');
    } else {
      this.logger.info('All services stopped');
    }
  }

  private async prepareBackendShutdown(): Promise<void> {
    const http = await import('node:http');
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (message?: string): void => {
        if (settled) return;
        settled = true;
        if (message) this.logger.warn(message);
        resolve();
      };
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: BACKEND_PORT,
          path: '/api/v1/system/prepare-shutdown',
          method: 'POST',
          headers: {
            'X-ReceiptBI-Desktop-Control': this.desktopControlToken,
          },
        },
        (response) => {
          response.resume();
          response.once('end', () => {
            const status = response.statusCode ?? 0;
            if (status >= 200 && status < 300) {
              this.logger.info('Backend acknowledged the safe shutdown request');
              finish();
            } else {
              finish(`Backend safe shutdown request returned HTTP ${status}`);
            }
          });
          response.once('error', (error) => {
            finish(`Backend safe shutdown response failed: ${error.message}`);
          });
        }
      );
      req.once('error', (error) => {
        finish(`Backend safe shutdown request failed: ${error.message}`);
      });
      req.setTimeout(2200, () => {
        req.destroy(new Error('Safe shutdown request timed out'));
      });
      req.end();
    });
  }

  private async stopOwnedProcess(owned: OwnedProcess): Promise<void> {
    if (owned.exited) return;

    try {
      if (owned.kind === 'utility') {
        (owned.child as UtilityProcess).kill();
      } else {
        (owned.child as ChildProcess).kill('SIGTERM');
      }
    } catch (error) {
      this.logger.warn(`Failed to stop owned ${owned.name} process gracefully`, error);
    }

    if (await this.waitForExit(owned, 3000)) return;

    const pid = owned.child.pid;
    this.logger.warn(`Force-killing owned ${owned.name} process${pid ? ` ${pid}` : ''}`);
    try {
      if (owned.kind === 'utility') {
        if (pid) process.kill(pid, 'SIGKILL');
        else (owned.child as UtilityProcess).kill();
      } else {
        (owned.child as ChildProcess).kill('SIGKILL');
      }
    } catch {
      // It may have exited between the timeout and the force-kill.
    }
    await this.waitForExit(owned, 2000);
  }

  private waitForExit(owned: OwnedProcess, timeoutMs: number): Promise<boolean> {
    if (owned.exited) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      owned.exitPromise.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  getStatus(): { backend: ServiceStatus; frontend: ServiceStatus } {
    return {
      backend: {
        name: 'Backend (Python API)',
        running: Boolean(this.backendProcess && !this.backendProcess.exited && this.backendReady),
        pid: this.backendProcess?.child.pid,
        url: `http://127.0.0.1:${BACKEND_PORT}`,
        error: this.backendError,
      },
      frontend: {
        name: 'Frontend (Next.js)',
        running: Boolean(this.frontendProcess && !this.frontendProcess.exited && this.frontendReady),
        pid: this.frontendProcess?.child.pid,
        url: `http://127.0.0.1:${FRONTEND_PORT}`,
        error: this.frontendError,
      },
    };
  }

  isReady(): boolean {
    const status = this.getStatus();
    return status.backend.running && status.frontend.running;
  }

  getFrontendUrl(): string {
    return `http://127.0.0.1:${FRONTEND_PORT}`;
  }

  getUserDataDir(): string {
    return this.userDataDir;
  }

  getStartupFolder(folder: 'backups' | 'logs'): string {
    return folder === 'backups'
      ? path.join(path.dirname(this.databasePath), '.receiptbi-backups')
      : path.join(this.userDataDir, 'logs');
  }
}
