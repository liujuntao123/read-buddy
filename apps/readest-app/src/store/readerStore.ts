import { create } from 'zustand';

export interface ReaderBookInfo {
  bookHash: string;
  bookTitle: string;
  spineCount: number;
}

export interface ReaderState {
  bookHash: string;
  bookTitle: string;
  /**
   * 物理阅读位置：引擎书籍的 spine 段序号；TXT 为虚拟分段序号（与节点序号一致）。
   * 它是「视口在哪」，不是「第几章第几节」——层级的判定一律交给节点模型
   * （`@/services/bookNodes`）。
   */
  spineIndex: number;
  /** 当前视口所在的段内目录锚点；undefined 表示该段起始处。 */
  anchor: string | undefined;
  /** 阅读位置标题：目录标题优先，回退到段标题。 */
  nodeTitle: string;
  /** 物理段总数（引擎书籍 = spine 长度）。 */
  spineCount: number;
  loadBook: (info: ReaderBookInfo) => void;
  /** 记录阅读位置（物理段 + 可选段内锚点 + 标题）。 */
  setPosition: (spineIndex: number, nodeTitle: string, anchor?: string) => void;
}

/**
 * Reading context store (CONTEXT.md "Reading Position"): active book hash, the
 * physical position the reader viewport sits at, and that position's title.
 * Downstream features (summaries, chat, segmentation) key off this state and
 * resolve it into a Book Node through `@/services/bookNodes`.
 */
export const useReaderStore = create<ReaderState>((set) => ({
  bookHash: '',
  bookTitle: '',
  spineIndex: 0,
  anchor: undefined,
  nodeTitle: '',
  spineCount: 0,
  loadBook: ({ bookHash, bookTitle, spineCount }) =>
    set({ bookHash, bookTitle, spineCount, spineIndex: 0, anchor: undefined, nodeTitle: '' }),
  setPosition: (spineIndex, nodeTitle, anchor) => set({ spineIndex, nodeTitle, anchor }),
}));
