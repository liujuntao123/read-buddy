'use client';

/**
 * Agent 思考与工具调用轨迹手风琴 (reading-agent doc §7.2 + user request):
 * a two-level accordion — the outer toggle collapses the whole trail, each
 * tool call inside is an independently expandable row revealing its
 * parameters, result snippet and duration. Running calls pulse until their
 * result arrives.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { toolLabel } from '@/services/agent/readingTools';
import type { ToolCallTrace } from '@/types/readingAgent';

export interface AgentTraceAccordionProps {
  traces: ToolCallTrace[];
  /** Open by default (used for the live streaming trail). */
  defaultOpen?: boolean;
}

const TRACE_TOOL_ICONS: Record<string, string> = {
  get_book_outline: '⚙️',
  read_node_passage: '📖',
  search_book_text: '🔍',
  locate_in_reader: '📍',
};

/** Compact `key=value` summary of a tool call for the row header. */
const argsSummary = (args: Record<string, unknown>): string =>
  Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 3)
    .map(([key, value]) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      return `${key}=${text.length > 18 ? `${text.slice(0, 18)}…` : text}`;
    })
    .join(' · ');

function TraceRow({ trace, index }: { trace: ToolCallTrace; index: number }) {
  const [open, setOpen] = useState(false);
  const running = !trace.resultSnippet && trace.durationMs === 0;
  const argsText = argsSummary(trace.args);

  return (
    <VStack
      gap={0}
      style={{
        borderRadius: 'var(--radius-tile)',
        border: '1px solid var(--color-border)',
        background: 'var(--color-background-surface)',
        minWidth: 0,
      }}
    >
      <HStack
        as="button"
        aria-expanded={open}
        data-testid="agent-trace-item-toggle"
        aria-label={`${toolLabel(trace.toolName)} 详情`}
        gap={2}
        vAlign="center"
        onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
          event.preventDefault();
          setOpen(!open);
        }}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-2)',
          width: '100%',
          boxSizing: 'border-box',
          padding: 'var(--spacing-1) var(--spacing-2)',
        }}
      >
        {open ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
        <Text type="supporting" aria-hidden>
          {TRACE_TOOL_ICONS[trace.toolName] ?? '🔧'}
        </Text>
        <Text type="supporting" weight="medium" style={{ flexShrink: 0 }}>
          {toolLabel(trace.toolName)}
        </Text>
        {argsText && (
          <Text type="supporting" color="secondary" maxLines={1} style={{ flex: 1, minWidth: 0, textAlign: 'start' }}>
            {argsText}
          </Text>
        )}
        <HStack gap={1} vAlign="center" style={{ flexShrink: 0 }}>
          {trace.durationMs > 0 && (
            <Text type="supporting" color="secondary" hasTabularNumbers>
              {`${trace.durationMs}ms`}
            </Text>
          )}
          <StatusDot
            variant={running ? 'accent' : 'success'}
            isPulsing={running}
            label={running ? '执行中' : '已完成'}
          />
        </HStack>
      </HStack>
      {open && (
        <VStack
          gap={1}
          data-testid="agent-trace-item-detail"
          style={{
            padding: 'var(--spacing-1) var(--spacing-2) var(--spacing-2)',
            borderTop: '1px solid var(--color-border)',
            minWidth: 0,
          }}
        >
          <Text type="supporting" color="secondary" style={{ wordBreak: 'break-all' }}>
            {`参数 ${JSON.stringify(trace.args)}`}
          </Text>
          <Text type="supporting" color="secondary" style={{ wordBreak: 'break-all' }}>
            {`结果 ${trace.resultSnippet ?? '（执行中…）'}`}
          </Text>
          <Text type="supporting" color="secondary">调用 #{index + 1}</Text>
        </VStack>
      )}
    </VStack>
  );
}

export default function AgentTraceAccordion({ traces, defaultOpen = false }: AgentTraceAccordionProps) {
  const [open, setOpen] = useState(defaultOpen);
  if (traces.length === 0) return null;

  return (
    <VStack
      data-testid="agent-trace-accordion"
      gap={1}
      style={{
        borderRadius: 'var(--radius-container)',
        border: '1px solid var(--color-border)',
        background: 'var(--color-background-muted)',
        padding: 'var(--spacing-1) var(--spacing-2)',
        width: '100%',
        minWidth: 0,
      }}
    >
      <HStack
        gap={1}
        vAlign="center"
        as="button"
        aria-expanded={open}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-1)',
          padding: 'var(--spacing-1) 0',
          boxSizing: 'border-box',
          width: '100%',
        }}
        data-testid="agent-trace-toggle"
        onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
          event.preventDefault();
          setOpen(!open);
        }}
      >
        {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
        <Wrench size={12} aria-hidden />
        <Text type="supporting" color="secondary">
          {`Agent 思考与工具调用轨迹 (${traces.length})`}
        </Text>
      </HStack>
      {open && (
        <VStack gap={1} data-testid="agent-trace-body" style={{ paddingInline: 0, minWidth: 0 }}>
          {traces.map((trace, index) => (
            <div key={`${trace.id}-${index}`} data-testid="agent-trace-item" style={{ minWidth: 0 }}>
              <TraceRow trace={trace} index={index} />
            </div>
          ))}
        </VStack>
      )}
    </VStack>
  );
}
