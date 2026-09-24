'use client';

/**
 * 伴读 Agent 工作台 (docs/architecture.md): the upgraded
 * companion chat tab. Every assistant reply may carry a collapsed tool-trace
 * accordion (思考与工具调用轨迹) and whole-book evidence citation cards that
 * jump the reader viewport; a silent indexing status row tracks the import
 * pipeline; the composer keeps the turn-quota topic model (ADR 0006).
 *
 * Around that core, the surfaces the product review found missing (ticket 14):
 *   - an empty state that *asks* something — welcome block + suggestion chips
 *     whose level word comes from the Node View, never a literal 章 / 节;
 *   - a setup card above the composer while no provider is configured, instead
 *     of failing on the reader's first question (ADR 0004: nothing is called
 *     until the reader asks);
 *   - failures as a classified banner *in the message stream* with 重试 /
 *     AI 设置, where the one truncated red line used to sit;
 *   - copy actions on every finished answer and on the whole topic.
 *
 * The parent (AISidebar) mounts this without props to use the default
 * `useChatStore` singleton; tests inject a store built by `createChatStore`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, MessageSquare, Plus, Send, Sparkles, Square, X } from 'lucide-react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { ChatMessage, ChatMessageBubble, ChatMessageList } from '@astryxdesign/core/Chat';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { List, ListItem } from '@astryxdesign/core/List';
import { Popover } from '@astryxdesign/core/Popover';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Token } from '@astryxdesign/core/Token';
import { type Message } from '@/types/ai';
import { useChatStore, turnQuotaLabel, type ChatStoreHook } from '@/store/chatStore';
import { canSend, retryTargetIndex } from '@/services/chat/conversationManager';
import { nodeKindLabel, resolveCurrentNodeView } from '@/services/bookNodes';
import { providerReady } from '@/services/ai/providerReadiness';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useReaderStore } from '@/store/readerStore';
import { useDismissOnWindowBlur } from '@/hooks/useDismissOnWindowBlur';
import MarkdownView from '@/components/common/MarkdownView';
import QuoteBlock from '@/components/common/QuoteBlock';
import CopyButton from '@/components/common/CopyButton';
import AIProviderSetupCard from '@/components/common/AIProviderSetupCard';
import AgentTraceAccordion from './AgentTraceAccordion';
import CitationCard from './CitationCard';
import IndexingStatusBar from './IndexingStatusBar';

/**
 * Remaining turns at or below this number paint the quota pill in the warning
 * colour: the reader should feel the cap approaching *before* the topic locks.
 */
const QUOTA_WARNING_TURNS = 2;

/** What the setup card promises *this* panel will do once a model exists. */
const SETUP_DESCRIPTION = '配置模型后，可以就当前阅读位置提问，伴读会检索全书后回答。';

interface ChatTabProps {
  /** Injectable store seam; defaults to the app-wide singleton. */
  store?: ChatStoreHook;
}

function UserMessage({ message }: { message: Message }) {
  return (
    <ChatMessage sender="user">
      {message.quoteText && (
        <ChatMessageBubble variant="ghost" width="100%">
          {/* Collapsible: a long quoted passage folds behind its
              「引用原文 · N 字 · 出处」 trigger so the question and the answer
              stay the visible content of the turn. */}
          <QuoteBlock
            text={message.quoteText}
            source={message.quoteSource}
            compact
            collapsible
            testId="user-quote"
          />
        </ChatMessageBubble>
      )}
      {/* `chat-question` = 「我问的那句话」的字号档位（小于模型正文，大于引用）。 */}
      <ChatMessageBubble className="chat-question" data-testid="user-bubble">
        {message.content}
      </ChatMessageBubble>
    </ChatMessage>
  );
}

/** Assistant reply: trace accordion + markdown body + citation cards + copy. */
function AssistantMessage({ message }: { message: Message }) {
  const traces = message.toolCalls ?? [];
  const citations = message.citations ?? [];
  return (
    <ChatMessage
      sender="assistant"
      metadata={
        // Revealed on hover/focus of the message (`.chat-copy-action` in
        // globals.css): an answer action that is always visible would add one
        // more thing to read under every turn.
        <CopyButton
          className="chat-copy-action"
          getText={() => message.content}
          label="复制回答"
          tooltip="复制这条回答"
          showCopiedText
          testId="copy-answer"
        />
      }
    >
      <ChatMessageBubble width="100%" data-testid="assistant-bubble">
        <VStack gap={2}>
          <AgentTraceAccordion traces={traces} />
          <MarkdownView content={message.content} />
        </VStack>
      </ChatMessageBubble>
      {citations.map((citation, index) => (
        <CitationCard key={`${citation.nodeIndex}-${index}`} citation={citation} />
      ))}
    </ChatMessage>
  );
}

/** Live turn: open trace trail while the answer streams in. */
function StreamingMessage({
  streamingText,
  liveTraces,
}: {
  streamingText: string;
  liveTraces: Message['toolCalls'];
}) {
  const hasToolActivity = (liveTraces?.length ?? 0) > 0;
  return (
    <ChatMessage sender="assistant">
      <ChatMessageBubble width="100%" data-testid="streaming-bubble">
        <VStack gap={2}>
          {hasToolActivity && <AgentTraceAccordion traces={liveTraces!} defaultOpen />}
          <MarkdownView content={streamingText} streaming />
        </VStack>
      </ChatMessageBubble>
    </ChatMessage>
  );
}

/**
 * Empty state: what the companion can do, and four questions to try. The level
 * word is the Node View's (`nodeKindLabel`) — a TXT 段 book must not be asked
 * about 「本节」 (CONTEXT.md / ADR 0010).
 */
function ChatEmptyState({ onPick }: { onPick: (question: string) => void }) {
  const bookHash = useReaderStore((s) => s.bookHash);
  const spineIndex = useReaderStore((s) => s.spineIndex);
  const anchor = useReaderStore((s) => s.anchor);
  const nodeTitle = useReaderStore((s) => s.nodeTitle);
  const bookTitle = useReaderStore((s) => s.bookTitle);

  const view = useMemo(
    () => resolveCurrentNodeView(),
    [bookHash, spineIndex, anchor, nodeTitle],
  );
  const level = nodeKindLabel(view.kind);

  const suggestions = useMemo(
    () => [
      `这一${level}主要讲了什么？`,
      `本${level}有哪些关键概念？`,
      '梳理一下到目前为止的脉络',
      '这本书讲了什么？',
    ],
    [level],
  );

  return (
    <VStack data-testid="chat-empty-state" gap={2} padding={1}>
      <HStack gap={2} vAlign="center">
        <Sparkles size={14} aria-hidden style={{ color: 'var(--color-accent)' }} />
        <Text weight="medium">有什么想问的？</Text>
      </HStack>
      <Text type="supporting" color="secondary" style={{ lineHeight: 1.6 }}>
        {/* 《》 is for the book title — node titles themselves never wear it. */}
        {bookTitle
          ? `回答会结合《${bookTitle}》的正文检索与全书脉络生成。`
          : '回答会结合全书正文检索与脉络生成。'}
      </Text>
      {/* Chips are Buttons, not Tokens: Tokens are metadata, these are actions. */}
      <HStack gap={1} wrap="wrap">
        {suggestions.map((question) => (
          <Button
            key={question}
            label={question}
            variant="secondary"
            size="sm"
            data-testid="chat-suggestion"
            onClick={() => onPick(question)}
          />
        ))}
      </HStack>
    </VStack>
  );
}

export default function ChatTab({ store = useChatStore }: ChatTabProps) {
  const conversation = store((s) => s.conversation);
  const messages = store((s) => s.messages);
  const topics = store((s) => s.topics);
  const streamingText = store((s) => s.streamingText);
  const liveTraces = store((s) => s.liveTraces);
  const phase = store((s) => s.phase);
  const error = store((s) => s.error);
  const quoteDraft = store((s) => s.quoteDraft);
  const inputDisabled = store((s) => s.inputDisabled);

  // The quota the store enforces — not a second read of the settings store, so
// the pill cannot disagree with the lock (候选 epilogue).
  const maxTurns = store((s) => s.maxTurns);

  const [input, setInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  const providerConfigured = useAISettingsStore((s) => providerReady(s.settings));
  const openSettings = useAISidebarStore((s) => s.openSettings);

  // Clicks into the book iframe (most of the window while reading) must
  // also dismiss the history popover.
  useDismissOnWindowBlur(historyOpen, () => setHistoryOpen(false));
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    void store.getState().refreshTopics();
  }, [store]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, streamingText, liveTraces.length]);
  // Selection toolbar "ask" action (ticket 05) requests input focus by event.
  useEffect(() => {
    const focusInput = () => {
      const el = inputRef.current;
      if (!el || el.disabled) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    };
    window.addEventListener('read-buddy:focus-chat-input', focusInput);
    return () => window.removeEventListener('read-buddy:focus-chat-input', focusInput);
  }, []);

  // When the "ask" action arrives from another tab the ChatTab may have just
  // been mounted, missing the focus event — focus whenever a quote draft appears.
  useEffect(() => {
    if (!quoteDraft) return;
    const el = inputRef.current;
    if (!el || el.disabled) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [quoteDraft]);

  const streaming = phase === 'streaming';
  const isClosed = !canSend(conversation);
  const remainingTurns = maxTurns - (conversation?.turnCount ?? 0);
  const retryable = retryTargetIndex(messages) !== -1;

  const submit = () => {
    const text = input.trim();
    if (!text || inputDisabled) return;
    setInput('');
    void store.getState().send(text, quoteDraft ?? undefined);
    store.getState().setQuoteDraft(null);
  };

  /**
   * A suggestion chip: with a provider configured it *is* the send; without
   * one it lands in the composer, so the reader still sees what was about to
   * happen and can finish the thought after 配置 AI 模型.
   */
  const pickSuggestion = (question: string) => {
    if (providerConfigured && !inputDisabled) {
      void store.getState().send(question);
      return;
    }
    setInput(question);
    inputRef.current?.focus();
  };

  return (
    <VStack data-testid="chat-tab-panel" gap={2} height="100%" style={{ minHeight: 0 }}>
      {/* Silent indexing status + topic switcher bar. */}
      <IndexingStatusBar />
      <HStack gap={1} vAlign="center">
        <Text weight="medium" maxLines={1} style={{ flex: 1, minWidth: 0 }} data-testid="current-topic-title">
          {conversation ? conversation.title : '新话题'}
        </Text>
        <Popover
          isOpen={historyOpen}
          onOpenChange={setHistoryOpen}
          placement="below"
          alignment="end"
          label="历史话题"
          width={256}
          content={
            <List density="compact" data-testid="topic-history-list">
              {topics.length === 0 && (
                <Text type="supporting" color="secondary" as="div" style={{ padding: 'var(--spacing-2)' }}>
                  暂无历史话题
                </Text>
              )}
              {topics.map((topic) => (
                <ListItem
                  key={topic.id}
                  data-testid="topic-item"
                  label={`${topic.isClosed ? '🔒 ' : ''}${topic.title}`}
                  isSelected={topic.id === conversation?.id}
                  endContent={
                    <Text type="supporting" hasTabularNumbers>
                      {topic.turnCount} / {maxTurns}
                    </Text>
                  }
                  onClick={() => {
                    setHistoryOpen(false);
                    void store.getState().selectTopic(topic.id);
                  }}
                />
              ))}
            </List>
          }
        >
          <IconButton
            label="历史话题"
            variant="ghost"
            size="sm"
            tooltip="历史话题"
            data-testid="history-topics-toggle"
            icon={<Clock size={14} aria-hidden />}
          />
        </Popover>
        <IconButton
          label="开启新话题"
          variant="ghost"
          size="sm"
          tooltip="开启新话题"
          icon={<Plus size={14} aria-hidden />}
          onClick={() => store.getState().startNewTopic()}
        />
        {/* 复制对话 lives here, not only on the quota-exhausted card: copying a
            good topic out is a normal thing to want mid-conversation. */}
        <CopyButton
          getText={() => store.getState().exportTranscript()}
          label="复制对话"
          tooltip="复制本轮对话"
          testId="copy-topic-transcript"
        />
      </HStack>

      {/* Message stream: user right, assistant left, live agent turn.
          The class is the reading-typography hook (globals.css) for every
          bubble in the list — markdown replies and plain-text questions. */}
      <ChatMessageList
        className="chat-message-list"
        data-testid="chat-messages"
        isStreaming={streaming}
        density="compact"
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBlock: 'var(--spacing-1)' }}
      >
        {messages.length === 0 && !streaming && <ChatEmptyState onPick={pickSuggestion} />}
        {messages.map((message) =>
          message.role === 'user' ? (
            <UserMessage key={message.id} message={message} />
          ) : (
            <AssistantMessage key={message.id} message={message} />
          ),
        )}
        {streaming && (
          <StreamingMessage streamingText={streamingText} liveTraces={liveTraces} />
        )}
        {/* Failure belongs in the stream, where the answer would have been —
            with the two ways out of it (docs/architecture.md, ticket 14 item 6). */}
        {error && (
          <Banner
            data-testid="chat-error"
            status="error"
            container="card"
            collapsible={false}
            title={error}
            endContent={
              <HStack gap={2} wrap="wrap">
                {retryable && (
                  <Button
                    label="重试"
                    variant="secondary"
                    size="sm"
                    data-testid="retry-message"
                    onClick={() => void store.getState().retry()}
                  />
                )}
                <Button
                  label="AI 设置"
                  variant="secondary"
                  size="sm"
                  data-testid="chat-error-settings"
                  onClick={openSettings}
                />
              </HStack>
            }
          />
        )}
        <div ref={bottomRef} />
      </ChatMessageList>

      {/* Turn quota pill. The colour is the early warning: 剩余 ≤2 轮 turn it
          yellow, and an exhausted topic red (the card below then takes over). */}
      <HStack justify="between" gap={2} vAlign="center" style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--spacing-2)' }}>
        <Token
          data-testid="turn-quota"
          icon={<MessageSquare size={12} aria-hidden />}
          color={remainingTurns <= 0 ? 'red' : remainingTurns <= QUOTA_WARNING_TURNS ? 'yellow' : 'default'}
          label={`${turnQuotaLabel(conversation, maxTurns)} 轮`}
          size="sm"
        />
      </HStack>

      {/* Pending selection quote (ticket 05 fills this via setQuoteDraft). */}
      {quoteDraft && (
        <HStack data-testid="quote-draft" gap={2} vAlign="start" style={{ width: '100%' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <QuoteBlock text={quoteDraft} compact testId="quote-draft-block" />
          </div>
          <IconButton
            label="清除引用"
            variant="ghost"
            size="sm"
            icon={<X size={14} aria-hidden />}
            onClick={() => store.getState().setQuoteDraft(null)}
          />
        </HStack>
      )}

      {/* Quota exhausted: lock the input and offer the two primary actions. */}
      {isClosed && (
        <Card data-testid="quota-exhausted-hint" variant="yellow" padding={3}>
          <VStack gap={2}>
            <Text as="p" style={{ lineHeight: 1.6 }}>
              当前话题已达轮数上限（{maxTurns}/{maxTurns}），建议开启新话题以保持回答质量。
            </Text>
            <HStack gap={2}>
              <Button
                label="开启新话题"
                variant="primary"
                size="sm"
                data-testid="start-new-topic"
                icon={<Plus size={14} aria-hidden />}
                onClick={() => store.getState().startNewTopic()}
              />
              <CopyButton
                getText={() => store.getState().exportTranscript()}
                label="复制对话"
                isIconOnly={false}
                variant="secondary"
                testId="copy-transcript"
              />
            </HStack>
          </VStack>
        </Card>
      )}

      {/* Unconfigured provider: name the capability and the fix *before* the
          first question fails (ticket 14 item 3). The composer stays visible —
          talking to a model is not the only thing on this panel. */}
      {!providerConfigured && (
        <AIProviderSetupCard testId="chat-setup" description={SETUP_DESCRIPTION} />
      )}

      {/* Composer: full width with inside-positioned action button and a fixed
          height. Sizing + the disabled native resize grip live in globals.css
          (`textarea[data-testid='chat-input']`): TextArea hands `style` to its
          wrapper div, never to the <textarea> itself. */}
      <div style={{ position: 'relative', width: '100%', flexShrink: 0 }}>
        <TextArea
          ref={inputRef}
          data-testid="chat-input"
          label="对话输入"
          isLabelHidden
          width="100%"
          rows={3}
          value={input}
          isDisabled={inputDisabled}
          placeholder="输入问题…（Enter 发送，Shift+Enter 换行）"
          onChange={setInput}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          style={{ width: '100%' }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 'var(--spacing-2)',
            right: 'var(--spacing-2)',
            zIndex: 5,
          }}
        >
          {streaming ? (
            <Button
              label="停止"
              variant="secondary"
              size="sm"
              data-testid="stop-stream"
              icon={<Square size={14} aria-hidden />}
              onClick={() => store.getState().stop()}
            />
          ) : (
            <Button
              label="发送"
              variant="primary"
              size="sm"
              isIconOnly
              data-testid="send-message"
              isDisabled={inputDisabled}
              icon={<Send size={15} aria-hidden />}
              onClick={submit}
            />
          )}
        </div>
      </div>
    </VStack>
  );
}
