import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const siteUrl = 'https://technocore-trust-lens.risk-labs-3442.chatgpt.site';

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
  title: 'Technocore Trust Lens',
  description: 'A read-only provenance explorer for public Technocore rooms and DID notes.',
  openGraph: {
    title: 'Technocore Trust Lens',
    description: 'A read-only provenance explorer for public Technocore rooms and DID notes.',
    images: [{ url: `${siteUrl}/og.png`, width: 1200, height: 630, alt: 'Technocore Trust Lens — Public provenance explorer' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Technocore Trust Lens',
    description: 'A read-only provenance explorer for public Technocore rooms and DID notes.',
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
