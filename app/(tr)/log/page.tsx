import { LogTradeForm } from "@/components/tr/LogTradeForm";
import { serviceAccountEmail } from "@/lib/tr/google";
import { LOGGABLE } from "@/lib/tr/sheets/write";
import { SERVICES } from "@/lib/tr/services";
import { requireViewer } from "@/lib/tr/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Log a trade · Track Record" };

export default async function LogPage() {
  const viewer = await requireViewer();
  if (!viewer.canLog) {
    return (
      <div className="rounded-2xl border border-line bg-card p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold">Logging trades is limited</h1>
        <p className="mt-1 text-sm text-muted">
          Only admins and this app&apos;s designated managers can add trades. Ask an admin to add you under People &amp;
          access.
        </p>
      </div>
    );
  }
  const services = SERVICES.filter((s) => (LOGGABLE as readonly string[]).includes(s.code)).map((s) => ({
    code: s.code,
    name: s.name,
    slug: s.slug,
  }));
  const sa = serviceAccountEmail();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Log a trade</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Record a closed trade. It&apos;s written straight into the service&apos;s spreadsheet — still the official
          record — and shows up in the track record right away.
        </p>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          War Room trades flow into their sheet from Airtable automatically, so keep logging those in Airtable.
        </p>
      </header>
      {!sa && (
        <p className="rounded-xl border border-warn/30 bg-warn-soft p-4 text-sm text-warn">
          This app has no Google service account yet, so it can&apos;t write to the sheets. Once one is configured and
          each sheet is shared with it as an Editor, this form will work.
        </p>
      )}
      <LogTradeForm services={services} sheetAccess={sa} />
    </div>
  );
}
