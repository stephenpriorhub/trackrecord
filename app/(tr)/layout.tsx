import { Inter } from "next/font/google";
import Script from "next/script";
import "../tr.css";
import { Sidebar, type NavGroup } from "@/components/tr/Sidebar";
import { allPublicationInfo } from "@/lib/tr/publications";
import { KIND_LABEL, SERVICES, type ServiceKind } from "@/lib/tr/services";
import { currentViewer } from "@/lib/tr/viewer";

const inter = Inter({ subsets: ["latin"] });

export const metadata = { title: "MTA Track Record" };

/**
 * The signed-in track record: sidebar of services + content.
 *
 * Access is enforced on each page (requireViewer), not here — a layout is not
 * a guard. This only builds navigation.
 */
export default async function TrackRecordLayout({ children }: { children: React.ReactNode }) {
  const [viewer, info] = await Promise.all([currentViewer(), allPublicationInfo(SERVICES.map((s) => s.code))]);

  const order: ServiceKind[] = ["TRADING", "HYBRID", "INVESTING"];
  const groups: NavGroup[] = [
    { title: "Overview", items: [{ href: "/", label: "All services" }] },
    ...order.map((k) => ({
      title: KIND_LABEL[k],
      items: SERVICES.filter((s) => s.kind === k).map((s) => ({
        href: `/s/${s.slug}`,
        label: s.name,
        logoUrl: info[s.code]?.logoUrl,
      })),
    })),
  ];
  const tools = viewer?.canAdmin
    ? [
        ...(viewer.canLog ? [{ href: "/log", label: "Log a trade" }] : []),
        { href: "/report", label: "Weekly report email" },
        { href: "/status", label: "Sheet sync & data checks" },
        { href: "/embeds", label: "Widgets" },
      ]
    : [];

  return (
    <div className={`${inter.className} min-h-screen bg-paper text-ink lg:flex`}>
      <Script
        src="https://oxfordhub.app/hub-nav.js"
        data-project-id={process.env.NEXT_PUBLIC_HUB_PROJECT_ID || "mta-track-record"}
        strategy="afterInteractive"
        id="hub-nav"
      />
      <Sidebar groups={groups} footer={tools} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
