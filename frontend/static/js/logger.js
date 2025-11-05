/**
 * 统一日志工具
 * - 支持按日志级别输出
 * - 默认根据运行环境（本地/生产）选择不同的日志级别
 * - 提供日志历史，便于调试与错误追踪
 */
(function registerLogger(global) {
    const LEVEL_PRIORITY = {
        silent: -1,
        error: 0,
        warn: 1,
        info: 2,
        debug: 3,
        trace: 4
    };

    const CONSOLE_METHOD = {
        error: 'error',
        warn: 'warn',
        info: 'info',
        debug: 'debug',
        trace: 'debug'
    };

    const STORAGE_KEY = 'querygpt:log_level';
    const HISTORY_LIMIT = 200;

    const host = global.location?.hostname || '';
    const isLocalhost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(host) || host.endsWith('.local');

    const storedLevel = (() => {
        try {
            return global.localStorage?.getItem(STORAGE_KEY) || null;
        } catch (_) {
            return null;
        }
    })();

    let globalLevel = normalizeLevel(storedLevel) || (isLocalhost ? 'debug' : 'warn');
    const loggerCache = new Map();
    const history = [];

    function normalizeLevel(level) {
        if (!level) return null;
        const lowered = String(level).toLowerCase().trim();
        return Object.prototype.hasOwnProperty.call(LEVEL_PRIORITY, lowered) ? lowered : null;
    }

    function shouldLog(level) {
        const normalized = normalizeLevel(level) || 'info';
        return LEVEL_PRIORITY[normalized] <= LEVEL_PRIORITY[globalLevel];
    }

    function buildConsoleFallback() {
        const fallback = {};
        ['error', 'warn', 'info', 'debug', 'trace'].forEach((level) => {
            fallback[level] = (...args) => {
                if (global.console && typeof global.console[level] === 'function') {
                    global.console[level](...args);
                } else if (global.console && typeof global.console.log === 'function') {
                    global.console.log(...args);
                }
            };
        });
        return fallback;
    }

    function persistLevel(level) {
        try {
            if (global.localStorage) {
                global.localStorage.setItem(STORAGE_KEY, level);
            }
        } catch (_) {
            // localStorage 可能不可用（隐私模式等），忽略持久化失败
        }
    }

    function recordHistory(entry) {
        history.push(entry);
        if (history.length > HISTORY_LIMIT) {
            history.shift();
        }
    }

    function formatPrefix(level, namespace) {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${level.toUpperCase()}]${namespace ? ` [${namespace}]` : ''}`;
    }

    class Logger {
        constructor(namespace = '') {
            this.namespace = namespace;
        }

        static get level() {
            return globalLevel;
        }

        static setLevel(level) {
            const normalized = normalizeLevel(level);
            if (!normalized) {
                throw new Error(`无效的日志级别: ${level}`);
            }
            globalLevel = normalized;
            persistLevel(normalized);
            return globalLevel;
        }

        static getHistory() {
            return history.slice();
        }

        static clearHistory() {
            history.length = 0;
        }

        static getLogger(namespace = '') {
            if (!loggerCache.has(namespace)) {
                loggerCache.set(namespace, new Logger(namespace));
            }
            return loggerCache.get(namespace);
        }

        child(suffix) {
            const namespace = this.namespace ? `${this.namespace}:${suffix}` : suffix;
            return Logger.getLogger(namespace);
        }

        error(...args) {
            this._log('error', args);
        }

        warn(...args) {
            this._log('warn', args);
        }

        info(...args) {
            this._log('info', args);
        }

        debug(...args) {
            this._log('debug', args);
        }

        trace(...args) {
            this._log('trace', args);
        }

        _log(level, originalArgs) {
            if (!shouldLog(level)) {
                return;
            }

            const consoleMethod = CONSOLE_METHOD[level] || 'log';
            const prefix = formatPrefix(level, this.namespace);
            const args = [prefix, ...originalArgs];

            recordHistory({
                level,
                namespace: this.namespace,
                timestamp: new Date().toISOString(),
                payload: originalArgs
            });

            try {
                const targetConsole = global.console || {};
                const fn = typeof targetConsole[consoleMethod] === 'function'
                    ? targetConsole[consoleMethod]
                    : targetConsole.log;
                if (typeof fn === 'function') {
                    fn.apply(targetConsole, args);
                }
            } catch (err) {
                // 在极端环境下（如早期浏览器）可能无法访问 console
            }
        }
    }

    Logger.LEVELS = Object.keys(LEVEL_PRIORITY);

    global.Logger = Logger;
    global.loggerFactory = {
        getLogger: Logger.getLogger,
        setLevel: Logger.setLevel,
        createSafeLogger(namespace = '') {
            if (global.Logger && typeof global.Logger.getLogger === 'function') {
                return global.Logger.getLogger(namespace);
            }
            const cacheKey = `fallback:${namespace}`;
            if (!loggerCache.has(cacheKey)) {
                loggerCache.set(cacheKey, buildConsoleFallback());
            }
            return loggerCache.get(cacheKey);
        },
        get level() {
            return Logger.level;
        }
    };
})(window);

