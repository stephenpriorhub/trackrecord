"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export interface NavItem {
  href: string;
  label: string;
  logoUrl?: string | null;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

function Item({ item, active, onClick }: { item: NavItem; active: boolean; onClick?: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
        active ? "bg-brand text-white" : "text-ink hover:bg-brand-soft"
      }`}
    >
      <span className="leading-snug">{item.label}</span>
    </Link>
  );
}

export function Sidebar({ groups, footer }: { groups: NavGroup[]; footer?: NavItem[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  const nav = (
    <nav className="space-y-6">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">{g.title}</p>
          <div className="space-y-0.5">
            {g.items.map((i) => (
              <Item key={i.href} item={i} active={isActive(i.href)} onClick={() => setOpen(false)} />
            ))}
          </div>
        </div>
      ))}
      {footer && footer.length > 0 && (
        <div className="border-t border-line pt-4">
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Tools</p>
          <div className="space-y-0.5">
            {footer.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                onClick={() => setOpen(false)}
                className={`block rounded-lg px-3 py-2 text-sm ${
                  isActive(i.href) ? "bg-brand-soft font-medium text-brand" : "text-muted hover:bg-brand-soft hover:text-ink"
                }`}
              >
                {i.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );

  return (
    <>
      {/* Phone / tablet: a bar with a menu button. */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-card px-4 py-3 lg:hidden">
        <Link href="/" className="flex items-center gap-2 font-semibold text-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mta-logo.png" alt="Monument Traders Alliance" className="h-6 w-auto" />
          <span>Track Record</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink"
          aria-expanded={open}
        >
          {open ? "Close" : "Services"}
        </button>
      </div>
      {open && <div className="border-b border-line bg-card px-3 py-4 lg:hidden">{nav}</div>}

      {/* Desktop: a fixed column. */}
      <aside className="hidden w-64 shrink-0 border-r border-line bg-card lg:block">
        <div className="sticky top-0 max-h-screen overflow-y-auto px-3 py-6">
          <Link href="/" className="mb-6 block px-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/mta-logo.png" alt="Monument Traders Alliance" className="h-auto w-full max-w-[200px]" />
            <span className="mt-2 block text-lg font-bold text-brand">Track Record</span>
          </Link>
          {nav}
        </div>
      </aside>
    </>
  );
}
