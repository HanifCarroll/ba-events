/**
 * Simple File Logger
 *
 * Lightweight logging utility that writes to both console and file.
 * No external dependencies - uses Node.js fs module directly.
 *
 * Usage:
 *   import { logger } from '@/shared/lib/logger'
 *   logger.info('Server started')
 *   logger.error('Something failed', { userId: 123 })
 *
 * Logs are written to: logs/server.log
 * Read with: tail -f logs/server.log
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// Configuration
const LOG_DIR = join(process.cwd(), 'logs')
const LOG_FILE = join(LOG_DIR, 'server.log')
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'debug'
const WRITE_TO_FILE = process.env.NODE_ENV !== 'test'

// Ensure log directory exists
function ensureLogDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true })
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
  if (!WRITE_TO_FILE) return

  try {
    ensureLogDir()
    appendFileSync(LOG_FILE, entry + '\n')
  } catch {
    // Silently fail file writes - don't crash the app
  }
}

// Core log function
function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  if (LOG_LEVELS[level] < LOG_LEVELS[MIN_LEVEL]) return

  const entry = formatEntry(level, message, meta)

  // Always write to console
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  consoleFn(entry)

  // Write to file
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
export function getLogFilePath(): string {
  return LOG_FILE
}
