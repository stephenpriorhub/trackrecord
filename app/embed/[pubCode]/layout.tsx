/**
 * Track Record embed wrapper. A plain div, not html/body — the root layout owns
 * those. Styles are inline so this route pulls in no global stylesheet, which is
 * what keeps the hub auth gate in globals.css away from a public embed.
 */
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: '#030712', color: 'white', fontFamily: 'system-ui, sans-serif', minHeight: '100vh' }}>
      {children}
    </div>
  )
}
