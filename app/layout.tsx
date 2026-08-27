import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const siteUrl = 'https://technocorelens.xyz';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Technocore Lens — Should I join this room?',
  description: 'A read-only guide to public Technocore rooms, ranked with transparent conversation signals.',
  openGraph: {
    title: 'Technocore Lens — Should I join this room?',
    description: 'A read-only guide to public Technocore rooms, ranked with transparent conversation signals.',
    images: [{ url: `${siteUrl}/og.png`, width: 1200, height: 630, alt: 'Technocore Lens — room decisions with transparent signals' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Technocore Lens — Should I join this room?',
    description: 'A read-only guide to public Technocore rooms, ranked with transparent conversation signals.',
    images: [`${siteUrl}/og.png`],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
