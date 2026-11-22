import { baLocal } from './format.ts'
import type { Draft } from './job.ts'
import type { ThreadsApi, ThreadsMetric } from './threads-api.ts'

function metric(metrics: ThreadsMetric[], name: string) {
  const item = metrics.find(item => item.name === name)
  return item?.total_value?.value ?? item?.value ?? item?.values?.at(-1)?.value
}

/** A local draft identifies each post and its format. This command never changes the draft or token. */
export async function threadsReport(drafts: Draft[], api: ThreadsApi, now: Date, days: number): Promise<string> {
  const rows: string[] = ['Date\tFormat\tViews\tLikes\tReplies\tReposts\tQuotes\tLink clicks\tPermalink']
  const since = now.getTime() - days * 86_400_000
  const published = drafts.flatMap(draft => {
    const post = draft.threads
    if (!post?.mediaId || !post.publishedAt) return []
    const at = Date.parse(post.publishedAt)
    return at >= since && at <= now.getTime() ? [{ format: draft.format, at, mediaId: post.mediaId, permalink: post.permalink }] : []
  })
  for (const post of published.sort((a, b) => a.at - b.at)) {
    const insights = await api.mediaInsights(post.mediaId)
    const activity = ['views', 'likes', 'replies', 'reposts', 'quotes'].map(name => metric(insights, name) ?? '—')
    const clicks = metric(insights, 'link_clicks') ?? metric(insights, 'clicks') ?? '—'
    rows.push([baLocal(new Date(post.at)).date, post.format, ...activity, clicks, post.permalink ?? await api.permalink(post.mediaId)].join('\t'))
  }
  rows.push(`Followers: ${metric(await api.accountInsights(), 'followers_count') ?? 'unavailable'}`)
  return rows.join('\n')
}
