import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'readest-plus',
  description: '零预处理、即开即读的沉浸式 AI 阅读伴侣',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
