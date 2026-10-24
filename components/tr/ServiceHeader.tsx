import type { PublicationInfo } from "@/lib/tr/publications";
import { Initials } from "@/components/tr/Initials";

/** Logo, name and the wiki's description of the service. */
export function ServiceHeader({
  info,
  kindLabel,
  gurus,
  extra,
}: {
  info: PublicationInfo;
  kindLabel: string;
  gurus: string[];
  extra?: React.ReactNode;
}) {
  const [lead, ...rest] = info.body;
  return (
    <header className="rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        {info.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={info.logoUrl} alt="" className="h-12 w-auto max-w-[220px] object-contain" />
        ) : (
          <Initials name={info.name} large />
        )}
        {extra}
      </div>
      <div className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{info.name}</h1>
          <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">{kindLabel}</span>
        </div>
        <p className="mt-0.5 text-sm text-muted">{gurus.join(" & ")}</p>
        {info.tagline && <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink">{info.tagline}</p>}
        {lead && lead !== info.tagline && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{lead}</p>}
        {rest.length > 0 && (
          <details className="mt-2 max-w-3xl text-sm text-muted">
            <summary className="cursor-pointer text-brand">More about this service</summary>
            <div className="mt-2 space-y-2 leading-relaxed">
              {rest.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </details>
        )}
      </div>
    </header>
  );
}
