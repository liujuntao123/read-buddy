'use client';

/**
 * 伴读对话 tab (ticket 04, design doc 4.4, ADR 0006): turn-quota companion
 * chat. The parent (AISidebar) mounts this without props to use the default
 * `useChatStore` singleton; tests inject a store built by `createChatStore`.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Plus, Send, Square, X } from 'lucide-react';
import type { Message } from '@/types/ai';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { useChatStore, type ChatStoreHook } from '@/store/chatStore';

interface ChatTabProps {
  /** Injectable store seam; defaults to the app-wide singleton. */
  store?: ChatStoreHook;
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  return (
    <div className={`chat ${isUser ? 'chat-end' : 'chat-start'}`}>
      {message.quoteText && (
        <blockquote className="mb-1 max-w-[85%] whitespace-pre-wrap border-l-2 border-base-300 pl-2 text-xs text-base-content/60">
          {`> ${message.quoteText}`}
        </blockquote>
      )}
      <div
        data-testid={isUser ? 'user-bubble' : 'assistant-bubble'}
        className={`chat-bubble whitespace-pre-wrap ${isUser ? 'chat-bubble-primary' : ''}`}
      >
        {message.content}
      </div>
    </div>
  );
}

export default function ChatTab({ store = useChatStore }: ChatTabProps) {
  const conversation = store((s) => s.conversation);
  const messages = store((s) => s.messages);
  const topics = store((s) => s.topics);
  const streamingText = store((s) => s.streamingText);
  const phase = store((s) => s.phase);
  const error = store((s) => s.error);
  const quoteDraft = store((s) => s.quoteDraft);
  const inputDisabled = store((s) => s.inputDisabled);

  const maxTurns = useAISettingsStore((s) => s.settings.maxTurnsPerTopic);

  const [input, setInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void store.getState().refreshTopics();
  }, [store]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, streamingText]);

  const streaming = phase === 'streaming';
  const isClosed = conversation?.isClosed ?? false;

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
    <div data-testid="chat-tab-panel" className="flex h-full min-h-0 flex-col gap-2">
      {/* Topic switcher bar: current topic, history dropdown, new topic. */}
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-sm font-medium" data-testid="current-topic-title">
          {conversation ? conversation.title : '新话题'}
        </span>
        <div className="dropdown dropdown-end">
          <button
            type="button"
            data-testid="history-topics-toggle"
            className="btn btn-ghost btn-xs whitespace-nowrap"
            onClick={() => setHistoryOpen((open) => !open)}
          >
            🕘 历史话题
          </button>
          {historyOpen && (
            <ul
              data-testid="topic-history-list"
              className="menu dropdown-content z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1 text-sm shadow-lg"
            >
              {topics.length === 0 && (
                <li className="px-2 py-1 text-base-content/50" aria-disabled="true">
                  暂无历史话题
                </li>
              )}
              {topics.map((topic) => (
                <li key={topic.id}>
                  <button
                    type="button"
                    data-testid="topic-item"
                    className={topic.id === conversation?.id ? 'active' : ''}
                    onClick={() => {
                      setHistoryOpen(false);
                      void store.getState().selectTopic(topic.id);
                    }}
                  >
                    <span className="truncate">
                      {topic.isClosed ? '🔒 ' : ''}
                      {topic.title}
                    </span>
                    <span className="text-xs text-base-content/50">
                      {topic.turnCount} / {maxTurns}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-xs whitespace-nowrap"
          onClick={() => store.getState().startNewTopic()}
        >
          <Plus className="size-3.5" aria-hidden="true" />➕ 开启新话题
        </button>
      </div>

      {/* Message stream: user right, assistant left, live streaming bubble. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-1" data-testid="chat-messages">
        {messages.length === 0 && !streaming && (
          <p className="text-xs text-base-content/50">向 AI 伴读助手提问当前章节的内容吧。</p>
        )}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {streaming && (
          <div className="chat chat-start">
            <div data-testid="streaming-bubble" className="chat-bubble whitespace-pre-wrap">
              {streamingText}
              <span className="ml-0.5 inline-block animate-pulse" aria-hidden="true">
                ▍
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Turn quota pill + error surface. */}
      <div className="flex items-center justify-between gap-2 border-t border-base-300 pt-2">
        <span data-testid="turn-quota" className="badge badge-soft badge-sm whitespace-nowrap">
          💬 {conversation?.turnCount ?? 0} / {maxTurns} 轮
        </span>
        {error && (
          <span data-testid="chat-error" className="truncate text-xs text-error" title={error}>
            {error}
          </span>
        )}
      </div>

      {/* Pending selection quote (ticket 05 fills this via setQuoteDraft). */}
      {quoteDraft && (
        <div className="flex items-start gap-2 rounded-box bg-base-200 px-2 py-1" data-testid="quote-draft">
          <blockquote className="min-w-0 flex-1 whitespace-pre-wrap border-l-2 border-base-300 pl-2 text-xs text-base-content/70">
            {`> ${quoteDraft}`}
          </blockquote>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            aria-label="清除引用"
            onClick={() => store.getState().setQuoteDraft(null)}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Quota exhausted: lock the input and offer the two primary actions. */}
      {isClosed && (
        <div
          data-testid="quota-exhausted-hint"
          className="rounded-box border border-warning/40 bg-warning/10 p-2 text-xs"
        >
          <p>本轮话题探讨已达上限（{maxTurns}/{maxTurns}），建议开启新话题以保持解答精准度</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="start-new-topic"
              className="btn btn-primary btn-xs"
              onClick={() => store.getState().startNewTopic()}
            >
              <Plus className="size-3.5" aria-hidden="true" />➕ 开启新话题
            </button>
            <button
              type="button"
              data-testid="copy-transcript"
              className="btn btn-outline btn-xs"
              onClick={() => void copyTranscript()}
            >
              {copied ? (
                <>
                  <Check className="size-3.5" aria-hidden="true" />已复制
                </>
              ) : (
                <>
                  <Copy className="size-3.5" aria-hidden="true" />📋 导出/复制本轮对话
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Composer. */}
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          data-testid="chat-input"
          className="textarea textarea-bordered min-h-16 flex-1 resize-none text-sm"
          placeholder="围绕当前章节提问…（Enter 发送，Shift+Enter 换行）"
          value={input}
          disabled={inputDisabled}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        {streaming ? (
          <button
            type="button"
            data-testid="stop-stream"
            className="btn btn-error btn-sm"
            onClick={() => store.getState().stop()}
          >
            <Square className="size-4" aria-hidden="true" />⏹ 停止
          </button>
        ) : (
          <button
            type="submit"
            data-testid="send-message"
            className="btn btn-primary btn-sm"
            disabled={inputDisabled}
            aria-label="发送"
          >
            <Send className="size-4" aria-hidden="true" />
          </button>
        )}
      </form>
    </div>
  );
}
