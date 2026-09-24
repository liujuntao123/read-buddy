# ADR 0006: User-Visible Turn Quotas Over Transparent History Slicing for AI Conversations

## Status
Accepted

## Context
In reading companion chat interfaces, managing conversation history across long chats has two classic paradigms:
1. **Silent Sliding Window**: The UI renders 50+ messages, but silently truncates context sent to the API to the latest $N$ turns (e.g., last 6 turns).
   - *Problem*: The user expects the assistant to remember messages they still see directly on screen, leading to confusing failures and broken continuity.
2. **Turn-Bounded Topics (Turn Quota)**: Conversations have an explicit, user-visible turn limit (e.g. 10 or 15 Q&A pairs per topic).
   - Once the quota is reached, the UI clearly notifies the user: *「当前话题已达轮数上限（10/10），建议开启新话题以保持回答质量。」*
   - All turns within the active topic are sent as context without hidden pruning.

## Decision
We adopt the **User-Visible Turn Quota** model:
1. Every new Conversation thread permits up to a configurable Turn Quota (default: **10 turns** / 20 messages).
2. The UI displays a discrete turn indicator (e.g., `3/10 轮`).
3. While under the quota, 100% of the active topic's messages + the current chapter text are included in the prompt.
4. When the quota is reached:
   - The input bar transitions to a prompt offering: *“开启新话题 (Start New Topic)”* or *“导出/复制对话”*.
   - Existing chat history remains permanently readable and reviewable under the History tab.

## Consequences

### Positive
- **Mental Model Alignment**: Eliminates the "invisible amnesia" problem of transparent sliding windows.
- **Context Density**: Prevents topic drift and keeps the prompt focused strictly on the relevant reading question.
- **Token Predictability**: Caps maximum token expenditure per API call.

### Negative / Trade-offs
- Users cannot have an indefinitely long, single-thread stream of thought across an entire 500-page book; they must segment discussions into distinct topics.
