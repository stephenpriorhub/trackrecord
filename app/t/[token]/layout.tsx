import { Inter } from "next/font/google";
import "../../tr.css";

const inter = Inter({ subsets: ["latin"] });

/**
 * Public, read-only track record pages. No hub-nav and no auth gate: these are
 * for anyone holding the link. Nothing here can change data.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${inter.className} min-h-screen bg-paper text-ink`}>
      <div className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-8">
          <span className="flex items-center gap-3 font-semibold text-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/mta-logo.png" alt="Monument Traders Alliance" className="h-7 w-auto" />
            <span className="border-l border-line pl-3">Track Record</span>
          </span>
        </div>
      </div>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">{children}</main>
    </div>
  );
}
