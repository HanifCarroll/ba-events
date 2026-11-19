#!/usr/bin/env bun
import { submitEmbeddingTask } from './embedding-task.ts'

submitEmbeddingTask('populate-embeddings', process.argv.slice(2))
