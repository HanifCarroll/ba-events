import type { TriggerConfig } from '@trigger.dev/sdk/v3'
import { playwright } from '@trigger.dev/build/extensions/playwright'

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
    ],
  },
}
