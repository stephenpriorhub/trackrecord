import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'MTA Track Record',
  description: 'Monument Traders Alliance — Portfolio Performance',
}

/**
 * Deliberately bare: html and body, nothing else.
 *
 * The hub navigation and globals.css (which hides the document until hub-nav.js
 * confirms a session) live in app/(hub)/layout.tsx instead. They must NOT be
 * here, because /embed/** is rendered inside other people's public pages: with
 * the auth gate in the root layout, an anonymous visitor gets a permanently
 * blank iframe, and hub-nav bounces them to a sign-in screen.
 *
 * So anything that needs a signed-in OxfordHub user goes under (hub); anything
 * public goes under /embed.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  )
}
