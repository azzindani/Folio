const IS_DEV = import.meta.env?.DEV ?? true;

type LogLevel = 'log' | 'warn' | 'error' | 'perf';

function emit(level: LogLevel, module: string, ...args: unknown[]): void {
  if (!IS_DEV) return;
  const prefix = `[${module}]`;
  switch (level) {
    // eslint-disable-next-line no-console
    case 'log': console.log(prefix, ...args); break;
    // eslint-disable-next-line no-console
    case 'warn': console.warn(prefix, ...args); break;
    // eslint-disable-next-line no-console
    case 'error': console.error(prefix, ...args); break;
    // eslint-disable-next-line no-console
    case 'perf': console.log(`${prefix} [perf]`, ...args); break;
  }
}

export const debug = {
  log: (module: string, ...args: unknown[]) => emit('log', module, ...args),
  warn: (module: string, ...args: unknown[]) => emit('warn', module, ...args),
  error: (module: string, ...args: unknown[]) => emit('error', module, ...args),
  perf: (module: string, ...args: unknown[]) => emit('perf', module, ...args),
};
