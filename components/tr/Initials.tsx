/** Stand-in for a service with no loadable logo: its initials on the brand tint. */
export function Initials({ name, large = false }: { name: string; large?: boolean }) {
  const letters = name
    .replace(/^The\s+/i, "")
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w) && !["of", "and", "&"].includes(w.toLowerCase()))
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join("");
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-xl bg-brand font-bold text-white ${
        large ? "h-14 w-14 text-lg" : "h-10 w-10 text-sm"
      }`}
      aria-hidden
    >
      {letters}
    </div>
  );
}
