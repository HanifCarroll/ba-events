import type { TriggerConfig } from '@trigger.dev/sdk/v3'
import { playwright } from '@trigger.dev/build/extensions/playwright'
import { syncEnvVars } from '@trigger.dev/build/extensions/core'

export const config: TriggerConfig = {
  project: 'proj_lqttmibcdepaslelatth',
  runtime: 'node',
  maxDuration: 3600, // 1 hour for long-running scraping jobs
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 30000,
      factor: 2,
    },
  },
  dirs: ['./src/trigger/jobs'],
  build: {
    extensions: [
      playwright({
        browsers: ['chromium'], // Only need Chromium for Meetup scraping
      }),
      // Sync BROWSERBASE_API_KEY from the local .env into the deployment env
      // so the Meetup scraper can use Browserbase cloud browsers in prod.
      syncEnvVars(() => {
        const key = process.env.BROWSERBASE_API_KEY
        if (!key) return []
        return [{ name: 'BROWSERBASE_API_KEY', value: key, isSecret: true }]
      }),
    ],
  },
}
