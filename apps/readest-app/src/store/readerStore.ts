import { create } from 'zustand';

export interface ReaderBookInfo {
  bookHash: string;
  bookTitle: string;
  sectionCount: number;
}

export interface ReaderState {
  bookHash: string;
  bookTitle: string;
  sectionIndex: number;
  chapterTitle: string;
  sectionCount: number;
  loadBook: (info: ReaderBookInfo) => void;
  setSection: (sectionIndex: number, chapterTitle: string) => void;
}

/**
 * Reading context store: active book hash, current section ordinal and its
 * title (CONTEXT.md "Reading Context"). Downstream features (summaries,
 * chat, segmentation) key off this state.
 */
export const useReaderStore = create<ReaderState>((set) => ({
  bookHash: '',
  bookTitle: '',
  sectionIndex: 0,
  chapterTitle: '',
  sectionCount: 0,
  loadBook: ({ bookHash, bookTitle, sectionCount }) =>
    set({ bookHash, bookTitle, sectionCount, sectionIndex: 0, chapterTitle: '' }),
  setSection: (sectionIndex, chapterTitle) => set({ sectionIndex, chapterTitle }),
}));
