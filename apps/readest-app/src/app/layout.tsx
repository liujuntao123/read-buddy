import type { Metadata } from 'next';
import AppThemeProvider from '@/components/AppThemeProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'readest-plus',
  description: '零预处理、即开即读的沉浸式 AI 阅读伴侣',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
      <body>
        <AppThemeProvider>{children}</AppThemeProvider>
      </body>
    </html>
  );
}
