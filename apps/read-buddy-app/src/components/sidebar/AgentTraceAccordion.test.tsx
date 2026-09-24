import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AgentTraceAccordion from './AgentTraceAccordion';
import type { ToolCallTrace } from '@/types/readingAgent';

const TRACES: ToolCallTrace[] = [
  {
    id: 'call-1',
    toolName: 'search_book_text',
    args: { query: '黑暗森林' },
    resultSnippet: '{"matches":[{"nodeIndex":33}]}',
    durationMs: 214,
  },
  {
    id: 'call-2',
    toolName: 'read_node_passage',
    args: { nodeIndex: 33, length: 1500 },
    durationMs: 96,
  },
];

describe('AgentTraceAccordion', () => {
  it('renders collapsed by default with the trail count', () => {
    render(<AgentTraceAccordion traces={TRACES} />);
    expect(screen.getByTestId('agent-trace-accordion').textContent).toContain(
      '思考与检索过程 (2)',
    );
    expect(screen.queryByTestId('agent-trace-body')).toBeNull();
  });

  it('expands per-tool-call rows independently revealing params and results', () => {
    render(<AgentTraceAccordion traces={TRACES} />);
    fireEvent.click(screen.getByTestId('agent-trace-toggle'));
    expect(screen.getByTestId('agent-trace-body')).toBeTruthy();
    const items = screen.getAllByTestId('agent-trace-item');
    expect(items).toHaveLength(2);
    // Headers carry the friendly label + args summary + duration.
    expect(items[0]!.textContent).toContain('检索全书关键词');
    expect(items[0]!.textContent).toContain('query=黑暗森林');
    expect(items[0]!.textContent).toContain('214ms');
    expect(items[1]!.textContent).toContain('查阅节点原文切片');

    // Details are hidden until the item itself is expanded (accordion).
    expect(screen.queryByTestId('agent-trace-item-detail')).toBeNull();
    fireEvent.click(screen.getAllByTestId('agent-trace-item-toggle')[0]!);
    const detail = screen.getByTestId('agent-trace-item-detail');
    expect(detail.textContent).toContain('"query"');
    expect(detail.textContent).toContain('{"matches":[{"nodeIndex":33}]}');
    expect(detail.textContent).toContain('调用 #1');

    // The second item stays collapsed.
    expect(screen.getAllByTestId('agent-trace-item-detail')).toHaveLength(1);
  });

  it('marks calls without results as running (no duration, no result detail)', () => {
    const running: ToolCallTrace = {
      id: 'call-run',
      toolName: 'locate_in_reader',
      args: { nodeIndex: 1, quoteSnippet: '灯塔熄灭' },
      durationMs: 0,
    };
    render(<AgentTraceAccordion traces={[running]} defaultOpen />);
    const item = screen.getByTestId('agent-trace-item');
    // Still executing: no duration badge, and expanding shows the running note.
    expect(item.textContent).not.toContain('ms');
    fireEvent.click(screen.getByTestId('agent-trace-item-toggle'));
    expect(screen.getByTestId('agent-trace-item-detail').textContent).toContain('（执行中…）');
  });
});
