# Chat streaming and response contract

The route keeps the v5 canonical wire contract and streams one final text
block, one `data-response`, and one sanitized reads-only execution trace. The
text is the final prose returned by the ToolLoopAgent; cards, directions,
venue data, links, and provenance are server-derived from executed tool
results.

The agent uses DeepSeek through `ToolLoopAgent`, `stopWhen: isStepCount(5)`, a
60-second total / 20-second step bound, a seven-second per-tool bound, and one
retry. It receives the latest user request, bounded recent visible
user/assistant DATA, and server-rehydrated prior/pinned facts. It may chain
tools until it writes final prose. It never receives mutation tools. If a final
model step times out after successful reads, the server preserves those
canonical artifacts with deterministic fallback text; failures without a
successful read return the deterministic error canonical.

`runSharedChatTurn` is the channel-neutral entry point used by both the web API
and Telegram. Authentication, persistence, rate limits, guest debug, and
channel-specific rendering remain outside the agent.
