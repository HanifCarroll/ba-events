#!/usr/bin/env bun
import { submitEmbeddingTask } from './embedding-task.ts'

submitEmbeddingTask('reembed-stale', process.argv.slice(2))
