import type { Metadata } from 'next';
import { Heebo } from 'next/font/google';
import { AppHeader } from '../components/AppHeader';
import { getCurrentUser } from '../lib/auth';
import './globals.css';

const heebo = Heebo({ subsets: ['hebrew', 'latin'], variable: '--font-heebo', display: 'swap' });

export const metadata: Metadata = {
  title: 'תפעול פנסיוני',
  description: 'מערכת תפעול פנסיוני',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const user = getCurrentUser();
  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="font-sans antialiased">
        {user ? <AppHeader user={user} /> : null}
        <main className="max-w-7xl mx-auto px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
