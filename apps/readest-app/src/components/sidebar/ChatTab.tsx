'use client';

/**
 * 伴读 Agent 工作台 (reading-agent architecture doc §7): the upgraded
 * companion chat tab. Every assistant reply may carry a collapsed tool-trace
 * accordion (思考与工具调用轨迹) and whole-book evidence citation cards that
 * jump the reader viewport; a silent indexing status row tracks the import
 * pipeline; the composer keeps the turn-quota topic model (ADR 0006).
 *
 * The parent (AISidebar) mounts this without props to use the default
 * `useChatStore` singleton; tests inject a store built by `createChatStore`.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Clock, Copy, Plus, Send, Square, X } from 'lucide-react';
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
import { canSend } from '@/services/chat/conversationManager';
import { useDismissOnWindowBlur } from '@/hooks/useDismissOnWindowBlur';
import MarkdownView from '@/components/common/MarkdownView';
import QuoteBlock from '@/components/common/QuoteBlock';
import AgentTraceAccordion from './AgentTraceAccordion';
import CitationCard from './CitationCard';
import IndexingStatusBar from './IndexingStatusBar';

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

/** Assistant reply: trace accordion + markdown body + citation cards. */
function AssistantMessage({ message }: { message: Message }) {
  const traces = message.toolCalls ?? [];
  const citations = message.citations ?? [];
  return (
    <ChatMessage sender="assistant">
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
  const [copied, setCopied] = useState(false);

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
    window.addEventListener('readest-plus:focus-chat-input', focusInput);
    return () => window.removeEventListener('readest-plus:focus-chat-input', focusInput);
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

  const submit = () => {
    const text = input.trim();
    if (!text || inputDisabled) return;
    setInput('');
    void store.getState().send(text, quoteDraft ?? undefined);
    store.getState().setQuoteDraft(null);
  };

  const copyTranscript = async () => {
    const text = store.getState().exportTranscript();
    let ok = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      // Legacy fallback for non-secure contexts.
      try {
        const helper = document.createElement('textarea');
        helper.value = text;
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        ok = document.execCommand('copy');
        document.body.removeChild(helper);
      } catch {
        ok = false;
      }
    }
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1500);
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
        {messages.length === 0 && !streaming && (
          <Text type="supporting" color="secondary" as="p">
            可以针对当前章节或全书内容随时提问。
          </Text>
        )}
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
        <div ref={bottomRef} />
      </ChatMessageList>

      {/* Turn quota pill + error surface. */}
      <HStack justify="between" gap={2} vAlign="center" style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--spacing-2)' }}>
        <Token
          data-testid="turn-quota"
          label={`💬 ${turnQuotaLabel(conversation, maxTurns)} 轮`}
          size="sm"
        />
        {error && (
          <Text
            type="supporting"
            maxLines={1}
            data-testid="chat-error"
            style={{ color: 'var(--color-error)' }}
          >
            {error}
          </Text>
        )}
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
                label="➕ 开启新话题"
                variant="primary"
                size="sm"
                data-testid="start-new-topic"
                icon={<Plus size={14} aria-hidden />}
                onClick={() => store.getState().startNewTopic()}
              />
              <Button
                label="复制对话"
                variant="secondary"
                size="sm"
                data-testid="copy-transcript"
                icon={copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                onClick={() => void copyTranscript()}
              >
                {copied ? '已复制' : '复制对话'}
              </Button>
            </HStack>
          </VStack>
        </Card>
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
              label="⏹ 停止"
              variant="destructive"
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
