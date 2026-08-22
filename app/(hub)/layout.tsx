import { Inter } from 'next/font/google'
import Script from 'next/script'
import '../globals.css'

const inter = Inter({ subsets: ['latin'] })

/**
 * Everything behind OxfordHub sign-in: the Track Record dashboard and Portfolio
 * Manager. globals.css is imported HERE and not in the root layout, so its
 * `html { visibility: hidden }` auth gate — undone by hub-nav.js once a session
 * is confirmed — applies only to these routes and never to a public embed.
 */
export default function HubLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${inter.className} min-h-screen bg-gray-950 text-white`}>
      <Script
        src="https://oxfordhub.app/hub-nav.js"
        data-project-id={process.env.NEXT_PUBLIC_HUB_PROJECT_ID || 'mta-track-record'}
        strategy="afterInteractive"
        id="hub-nav"
      />
      {children}
    </div>
  )
}
