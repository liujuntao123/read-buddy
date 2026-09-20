'use client';

/**
 * Temporary sidebar placeholder. Replaced by the real AISidebar container
 * in ticket 01 (split-screen container + AI provider config center).
 */
export default function AISidebarPlaceholder() {
  return (
    <aside
      className="hidden w-[400px] shrink-0 border-l border-base-300 bg-base-100 p-4 md:block"
      data-testid="ai-sidebar-placeholder"
    >
      <div className="rounded-box border border-dashed border-base-300 p-4 text-sm text-base-content/60">
        AI 伴读侧边栏 — 工单 01 实施中（分屏容器与配置中心）
      </div>
    </aside>
  );
}
