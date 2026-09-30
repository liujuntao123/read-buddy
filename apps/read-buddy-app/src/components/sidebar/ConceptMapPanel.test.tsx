import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConceptMapPanel from './ConceptMapPanel';
import type { NodeView } from '@/services/bookNodes';
import { clearLocateListeners, subscribeLocate } from '@/services/reader/readerLink';
import { useChatStore } from '@/store/chatStore';
import { useAISidebarStore } from '@/store/aiSidebarStore';

vi.mock('./ConceptGraph', () => ({ default: ({ onSelect }: { onSelect: (id: string) => void }) =>
  <button onClick={() => onSelect('section-0:0')}>选择要义节点</button> }));
const text = '主动回忆帮助我们更长久地保留知识。';
const summary = `## 核心要义\n- ${text}\n## 关键内容脉络\n1. **建立联系**：主动回忆与知识应用互相促进。\n## 核心概念与关键术语\n- **主动回忆**：尝试从记忆中主动提取知识。`;
const view: NodeView = { bookHash: 'map-book', nodeIndex: 2, spineIndex: 1, title: '理解与记忆',
  text, charCount: text.length, kind: 'section', source: 'context' };
afterEach(() => clearLocateListeners());

describe('summary-linked concept map', () => {
  it('prepares a concept question without sending an AI request', () => {
    const send = vi.spyOn(useChatStore.getState(), 'send');
    render(<ConceptMapPanel view={view} summary={summary} onSummary={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '选择要义节点' }));
    fireEvent.click(screen.getByRole('button', { name: '追问这个概念' }));
    expect(useChatStore.getState().quoteDraft).toContain(text);
    expect(useAISidebarStore.getState().activeTab).toBe('chat');
    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
  });
  it('previews on selection, only navigates on explicit source action', () => {
    const navigate = vi.fn(); subscribeLocate(navigate);
    render(<ConceptMapPanel view={view} summary={summary} onSummary={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '选择要义节点' }));
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByText('原文依据')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看原文' }));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ bookHash: 'map-book', nodeIndex: 2, quoteSnippet: text }));
  });
  it('links a selected node back to the correct summary section', () => {
    const onSummary = vi.fn();
    render(<ConceptMapPanel view={view} summary={summary} onSummary={onSummary} />);
    fireEvent.click(screen.getByRole('button', { name: '选择要义节点' }));
    fireEvent.click(screen.getByRole('button', { name: '查看对应总结' }));
    expect(onSummary).toHaveBeenCalledWith('section-0');
  });
  it('searches all summary items including collapsed branches', () => {
    render(<ConceptMapPanel view={view} summary={summary} onSummary={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '打开搜索与大纲' }));
    fireEvent.change(screen.getByRole('textbox', { name: '搜索总结中的概念' }), { target: { value: '建立联系' } });
    expect(screen.getByText('建立联系')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索总结中的概念' }), { target: { value: '没有这个内容' } });
    expect(screen.getByText('没有匹配的内容，请换一个关键词。')).toBeTruthy();
  });
  it('offers the existing summary flow instead of a separate model generation', () => {
    const generate = vi.fn();
    render(<ConceptMapPanel view={view} summary="" onSummary={vi.fn()} onGenerateSummary={generate} />);
    fireEvent.click(screen.getByRole('button', { name: '生成总结与地图' }));
    expect(generate).toHaveBeenCalledOnce();
    expect(screen.queryByText('选择要义节点')).toBeNull();
  });
});
