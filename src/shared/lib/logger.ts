/**
 * Simple Logger
 *
 * Lightweight logging utility that works in both browser and Node.js.
 * In Node.js: writes to both console and file
 * In browser: writes to console only
 *
 * Usage:
 *   import { logger } from '@/shared/lib/logger'
 *   logger.info('Server started')
 *   logger.error('Something failed', { userId: 123 })
 *
 * Server logs are written to: logs/server.log
 * Read with: tail -f logs/server.log
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// Detect environment
const isNode = typeof process !== 'undefined' && process.versions?.node

// Configuration
const MIN_LEVEL: LogLevel = (isNode ? (process.env.LOG_LEVEL as LogLevel) : null) || 'debug'
const WRITE_TO_FILE = isNode && process.env.NODE_ENV !== 'test'

// Lazy-loaded Node.js modules (only in Node environment)
let fs: typeof import('fs') | null = null
let path: typeof import('path') | null = null
let LOG_DIR: string | null = null
let LOG_FILE: string | null = null

async function initNodeModules() {
  if (!isNode || fs) return
  fs = await import('fs')
  path = await import('path')
  LOG_DIR = path.join(process.cwd(), 'logs')
  LOG_FILE = path.join(LOG_DIR, 'server.log')
}

// Ensure log directory exists
function ensureLogDir() {
  if (!fs || !LOG_DIR) return
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true })
  }
}

// Format log entry
function formatEntry(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString()
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : ''
  return `[${timestamp}] [${level.toUpperCase().padEnd(5)}] ${message}${metaStr}`
}

// Write to file (sync for simplicity - async would be better for high volume)
function writeToFile(entry: string) {
  if (!WRITE_TO_FILE || !fs || !LOG_FILE) return

  try {
    ensureLogDir()
    fs.appendFileSync(LOG_FILE, entry + '\n')
  } catch {
    // Silently fail file writes - don't crash the app
  }
}

// Initialize on first use in Node
if (isNode) {
  initNodeModules()
}

// Core log function
function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  if (LOG_LEVELS[level] < LOG_LEVELS[MIN_LEVEL]) return

  const entry = formatEntry(level, message, meta)

  // Always write to console
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  consoleFn(entry)

  // Write to file (Node.js only)
  writeToFile(entry)
}

// Export logger interface
export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),

  // Convenience method for logging errors with stack traces
  logError: (message: string, error: unknown, meta?: Record<string, unknown>) => {
    const errorMeta = {
      ...meta,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }
    log('error', message, errorMeta)
  },
}

// Also export a function to get the log file path (useful for reading)
export function getLogFilePath(): string | null {
  return LOG_FILE
}
