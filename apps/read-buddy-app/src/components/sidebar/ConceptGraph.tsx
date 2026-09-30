'use client';

import { useEffect, useRef, useState } from 'react';
import type { Graph, GraphData, RectStyleProps } from '@antv/g6';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import { Focus, Minus, Plus, LocateFixed, RotateCcw } from 'lucide-react';
import { visibleConcepts } from '@/services/conceptMap/conceptMap';
import { ROLE_LABEL, type SummaryMap } from '@/services/conceptMap/summaryMap';
import { useReadingTheme } from '@/theme/readingTheme';

let registered = false;
interface Props {
  data: SummaryMap; collapsed: ReadonlySet<string>; selected: string | null;
  onSelect: (id: string) => void; onToggle: (id: string) => void;
  expanded: boolean; showRelations: boolean; focusId?: string;
}

export default function ConceptGraph(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const graph = useRef<Graph | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const update = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [retry, setRetry] = useState(0);
  const theme = useReadingTheme();

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    let instance: Graph | undefined;
    let resize: ResizeObserver | undefined;
    let queue = Promise.resolve();
    setReady(false);
    setFailed(false);
    void (async () => {
      const { Graph, Rect, register, ExtensionCategory } = await import('@antv/g6');
      if (disposed) return;
      if (!registered) {
        class ReadingNode extends Rect {
          render(attributes = this.parsedAttributes, parent = this) {
            super.render(attributes, parent);
            const a = attributes as Required<RectStyleProps> & {
              heading: string; caption: string; ink: string; accent: string; surface: string;
              count: number; folded: boolean; root: boolean;
            };
            const width = Number(Array.isArray(a.size) ? a.size[0] : a.size);
            this.upsert('role-line', 'rect', { x: -width / 2, y: -35, width: 3, height: 70,
              radius: 2, fill: a.accent, pointerEvents: 'none' }, parent);
            this.upsert('heading', 'text', { x: -width / 2 + 18, y: -8, text: a.heading,
              fontFamily: 'sans-serif', fontSize: 15, fontWeight: a.root ? 600 : 500,
              fill: a.ink, wordWrap: true, wordWrapWidth: width - 42, maxLines: 2,
              textOverflow: 'ellipsis', lineHeight: 21, textBaseline: 'middle', pointerEvents: 'none' }, parent);
            this.upsert('caption', 'text', { x: -width / 2 + 18, y: 24, text: a.caption,
              fontSize: 10, fill: a.accent, textBaseline: 'middle', pointerEvents: 'none' }, parent);
            this.upsert('fold-control', 'circle', a.count ? { cx: width / 2, cy: 0, r: 11,
              fill: a.surface, stroke: a.accent, lineWidth: 1, cursor: 'pointer' } : false, parent);
            this.upsert('fold-sign', 'text', a.count ? { x: width / 2, y: 0,
              text: a.folded ? '+' : '−', fontSize: 15, fill: a.accent,
              textAlign: 'center', textBaseline: 'middle', pointerEvents: 'none' } : false, parent);
          }
        }
        register(ExtensionCategory.NODE, 'reading-summary-node', ReadingNode);
        registered = true;
      }
      const color = (token: string) => {
        const probe = document.createElement('i');
        probe.style.color = `var(${token})`;
        container.appendChild(probe);
        const result = getComputedStyle(probe).color;
        probe.remove();
        return result;
      };
      const ink = color('--color-text-primary'), secondary = color('--color-text-secondary');
      const surface = color('--color-background-surface'), border = color('--color-border-emphasized');
      const muted = color('--color-background-muted');
      const accents = { theme: secondary, core: color('--color-text-blue'),
        outline: color('--color-text-cyan'), terms: color('--color-text-orange') };
      const fills = { theme: surface, core: color('--color-background-blue'),
        outline: color('--color-background-cyan'), terms: color('--color-background-orange') };
      const build = (): GraphData => {
        const { data, collapsed, selected, showRelations } = latest.current;
        const nodes = visibleConcepts(data, collapsed);
        const visible = new Set(nodes.map((n) => n.id));
        const positions = new Map<string, { x: number; y: number }>();
        let row = 0;
        const place = (id: string, depth: number): number => {
          const children = nodes.filter((n) => n.parentId === id);
          const ys = children.map((c) => place(c.id, depth + 1));
          const y = ys.length ? (ys[0]! + ys.at(-1)!) / 2 : row++ * 114;
          positions.set(id, { x: depth * 310, y });
          return y;
        };
        place('root', 0);
        const related = new Set([selected]);
        for (const r of data.relations) {
          if (r.source === selected) related.add(r.target);
          if (r.target === selected) related.add(r.source);
        }
        return {
          nodes: nodes.map((node) => {
            const c = data.concepts.find((n) => n.id === node.id)!;
            const count = data.concepts.filter((n) => n.parentId === c.id).length;
            const active = c.id === selected;
            return { id: c.id, style: { ...positions.get(c.id),
              heading: c.label, caption: c.isGroup ? `${ROLE_LABEL[c.role]}${count ? `  ·  ${count} 项` : ''}`
                : `${ROLE_LABEL[c.role]}  /  ${String(c.order).padStart(2, '0')}`,
              ink, accent: accents[c.role], surface, count, folded: collapsed.has(c.id), root: c.id === 'root',
              fill: active || c.isGroup ? fills[c.role] : surface,
              stroke: active ? accents[c.role] : border, lineWidth: active ? 2 : 1,
              opacity: selected && !related.has(c.id) && !c.isGroup ? 0.65 : 1,
              shadowColor: active ? accents[c.role] : 'transparent', shadowBlur: active ? 5 : 0,
            } };
          }),
          edges: [
            ...nodes.filter((c) => c.parentId && visible.has(c.parentId)).map((c) => ({
              id: `tree:${c.id}`, source: c.parentId!, target: c.id,
              style: { stroke: border, lineWidth: c.parentId === 'root' ? 1.5 : 1 },
            })),
            ...data.relations.filter((r) => visible.has(r.source) && visible.has(r.target) &&
              (showRelations || r.source === selected || r.target === selected)).map((r, i) => ({
              id: `relation:${i}`, source: r.source, target: r.target,
              style: { stroke: accents.terms, lineDash: [4, 5], endArrow: true,
                labelText: r.label, labelFill: secondary, labelFontSize: 10,
                labelBackground: true, labelBackgroundFill: surface },
            })),
          ],
        };
      };
      instance = new Graph({ container, width: container.clientWidth, height: container.clientHeight,
        animation: false, padding: [24, 28, 64, 28], zoomRange: [0.2, 2],
        behaviors: ['drag-canvas', 'zoom-canvas'], data: build(),
        node: { type: 'reading-summary-node', style: { size: [236, 88], radius: 10,
          label: false, cursor: 'pointer', fill: surface },
          state: { hover: { lineWidth: 2, fill: muted } } },
        edge: { type: 'cubic-horizontal', style: { stroke: border } },
      });
      const idOf = (e: Parameters<Graph['emit']>[1]) => e && typeof e === 'object' && 'target' in e
        ? String((e.target as { id?: string })?.id ?? '') : '';
      instance.on('node:click', (event) => {
        const id = idOf(event);
        if (!id) return;
        const origin = 'originalTarget' in event ? event.originalTarget as { className?: string } : null;
        if (origin?.className === 'fold-control') latest.current.onToggle(id);
        else latest.current.onSelect(id);
      });
      instance.on('node:pointerenter', (event) => {
        const id = idOf(event); if (id) void instance?.setElementState(id, ['hover'], false).catch(() => {});
      });
      instance.on('node:pointerleave', (event) => {
        const id = idOf(event); if (id) void instance?.setElementState(id, [], false).catch(() => {});
      });
      await instance.render();
      if (disposed) return;
      instance.on('aftertransform', () => { if (!disposed && instance && !instance.destroyed) setZoom(Math.round(instance.getZoom() * 100)); });
      await instance.fitView();
      if (disposed) return;
      if (instance.getZoom() > 1) await instance.zoomTo(1, false);
      graph.current = instance;
      setZoom(Math.round(instance.getZoom() * 100));
      setReady(true);
      let lastFocus: string | undefined;
      let previousCollapsed = new Set(latest.current.collapsed);
      update.current = () => {
        queue = queue.then(async () => {
          if (disposed || !instance) return;
          const opened = [...previousCollapsed].find((id) => !latest.current.collapsed.has(id));
          previousCollapsed = new Set(latest.current.collapsed);
          instance.setData(build());
          await instance.draw();
          if (!disposed && opened) {
            // Keep the user's zoom, but bring the newly revealed branch into view.
            const branch = latest.current.data.concepts.filter((c) => c.id === opened || c.parentId === opened).map((c) => c.id);
            await instance.focusElement(branch, false);
          } else if (!disposed && latest.current.focusId && latest.current.focusId !== lastFocus) {
            lastFocus = latest.current.focusId;
            await instance.focusElement(lastFocus, false);
          }
        }).catch(() => { if (!disposed) setFailed(true); });
      };
      update.current();
      resize = new ResizeObserver(() => {
        if (!disposed && instance && container.clientWidth && container.clientHeight)
          instance.setSize(container.clientWidth, container.clientHeight);
      });
      resize.observe(container);
    })().catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; resize?.disconnect(); update.current = null;
      graph.current = null; instance?.destroy(); };
  }, [theme, retry]);

  useEffect(() => { update.current?.(); }, [props.data, props.collapsed, props.selected, props.showRelations]);
  useEffect(() => {
    if (!ready || !props.focusId) return;
    void graph.current?.focusElement(props.focusId, false).catch(() => {});
  }, [props.focusId, ready]);
  const run = (action: (g: Graph) => Promise<void>) => {
    if (graph.current) void action(graph.current).catch(() => setFailed(true));
  };
  return <VStack gap={0} style={{ position: 'relative', minWidth: 0 }}>
    <VStack ref={host} data-testid="concept-graph" role="img" aria-label="总结概念地图，文字大纲提供同等键盘操作"
      style={{ width: '100%', height: props.expanded ? '58dvh' : 'calc(var(--spacing-10) * 9)',
        background: 'var(--color-background-surface)', borderRadius: 'var(--radius-container)', overflow: 'hidden' }} />
    {(!ready || failed) && <VStack padding={4} style={{ position: 'absolute', inset: 0, background: 'var(--color-background-surface)' }} hAlign="center" vAlign="center">
      <Text color="secondary" role="status">{failed ? '地图暂时无法显示，仍可使用文字大纲' : '正在铺开总结脉络…'}</Text>
      {failed && <IconButton label="重新加载画布" icon={<RotateCcw />} onClick={() => setRetry((n) => n + 1)} />}
    </VStack>}
    <HStack gap={0} vAlign="center" padding={1} style={{ position: 'absolute', bottom: 'var(--spacing-3)', right: 'var(--spacing-3)',
      background: 'var(--color-background-surface)', borderRadius: 'var(--radius-container)', boxShadow: 'var(--shadow-sm)' }}>
      <IconButton label="缩小地图" tooltip="缩小" icon={<Minus size={15} />} size="sm" variant="ghost" isDisabled={!ready} onClick={() => run((g) => g.zoomBy(0.8, false))} />
      <Text type="supporting" hasTabularNumbers style={{ minWidth: 'var(--spacing-10)', textAlign: 'center' }}>{zoom}%</Text>
      <IconButton label="放大地图画布" tooltip="放大" icon={<Plus size={15} />} size="sm" variant="ghost" isDisabled={!ready} onClick={() => run((g) => g.zoomBy(1.25, false))} />
      <IconButton label="查看全图" tooltip="适应画布" icon={<Focus size={15} />} size="sm" variant="ghost" isDisabled={!ready} onClick={() => run((g) => g.fitView())} />
      <IconButton label="聚焦选中概念" tooltip="聚焦选中概念" icon={<LocateFixed size={15} />} size="sm" variant="ghost" isDisabled={!ready || !props.selected} onClick={() => run(async (g) => { await g.zoomTo(1, false); await g.focusElement(props.selected!, false); })} />
    </HStack>
  </VStack>;
}
