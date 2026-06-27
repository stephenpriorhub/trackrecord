import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'MTA Track Record',
  description: 'Monument Traders Alliance — Portfolio Performance',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-950 text-white`}>
        <Script
          src="https://oxfordhub.app/hub-nav.js"
          data-project-id={process.env.NEXT_PUBLIC_HUB_PROJECT_ID || 'PLACEHOLDER_PROJECT_ID'}
          strategy="afterInteractive"
          id="hub-nav"
        />
        {children}
      </body>
    </html>
  )
}
