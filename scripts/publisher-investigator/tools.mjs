import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const { BA_INVESTIGATION_DIR: dir, BA_INVESTIGATION_ENTRY: entry, BA_INVESTIGATION_NODE: node } = process.env
const operations = ['overview', 'image', 'flyer', 'catalog', 'occurrences', 'search', 'research', 'catalog-fix', 'finish', 'remember']

export default function (pi) {
  pi.registerTool({
    name: 'publisher_investigation', label: 'Publisher Investigation',
    description: 'Read saved evidence, read the event catalog, research public pages, apply a guarded catalog fix, or save a finding. See your runbook.',
    parameters: { type: 'object', required: ['action', 'data'], additionalProperties: false, properties: {
      action: { type: 'string', enum: operations }, data: { type: 'string', description: 'JSON-encoded input for the operation.' },
    } },
    async execute(_id, { action, data }, signal) {
      const reply = text => ({ content: [{ type: 'text', text }], details: {} })
      if (!operations.includes(action) || data.length > 12_000) return reply('Invalid operation or input.')
      try {
        let command = ['investigator-tool', dir, action, data]
        if (action === 'catalog-fix') {
          const fix = JSON.parse(data)
          const argument = v => typeof v === 'string' ? v : v === null ? 'null' : ''
          command = ['catalog-fix', argument(fix.id), `--field=${argument(fix.field)}`, `--from=${argument(fix.from)}`,
            `--to=${argument(fix.to)}`, `--evidence=${argument(fix.evidence)}`, ...(fix.allOccurrences === true ? ['--all-occurrences'] : [])]
        }
        const { stdout } = await exec(node, ['--no-warnings', '--experimental-transform-types', entry, ...command], { signal, timeout: 110_000, maxBuffer: 10_000_000 })
        const result = JSON.parse(stdout)
        if (result?.jpeg) return { content: [{ type: 'image', data: result.jpeg, mimeType: 'image/jpeg' }], details: {} }
        return reply(result?.jpeg === null ? 'No retained flyer.' : JSON.stringify(result))
      } catch (error) {
        // Never use execFile's Error.message: it embeds the process command line.
        const message = typeof error.stderr === 'string' ? error.stderr.trim() : ''
        if (error.code === 2 && /^[^\r\n]+$/u.test(message)) return reply(message.slice(0, 600))
        return reply('The operation could not complete.')
      }
    },
  })
}
