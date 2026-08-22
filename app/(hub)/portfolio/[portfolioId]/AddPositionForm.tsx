"use client";

/**
 * Adding a position.
 *
 * The default form is six plain fields — ticker, date, entry price, buy up to,
 * stop-loss, comment — because most recommendations are "buy this stock" and the
 * gurus using this are not all technical. Options are behind a single checkbox,
 * and even then a leg is described the way a person says it out loud (expiry,
 * strike, call or put, buy or sell). Nobody is ever shown or asked for an OCC
 * symbol; lib/occ.ts builds that from these fields.
 */
import { useActionState, useState } from "react";
import type { ActionResult } from "../../actions";

type Leg = {
  id: number;
  side: "BUY" | "SELL";
  expiry: string;
  strike: string;
  right: "CALL" | "PUT";
  price: string;
};

let nextLegId = 1;
function blankLeg(): Leg {
  nextLegId += 1;
  return {
    id: nextLegId,
    side: "BUY",
    expiry: "",
    strike: "",
    right: "CALL",
    price: "",
  };
}

const field =
  "rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600";
const label = "text-xs uppercase tracking-wide text-gray-500";

export default function AddPositionForm({
  portfolioId,
  action,
}: {
  portfolioId: string;
  action: (form: FormData) => Promise<ActionResult>;
}) {
  const [isOption, setIsOption] = useState(false);
  const [legs, setLegs] = useState<Leg[]>([blankLeg()]);
  const [result, submit, pending] = useActionState(
    async (_prev: ActionResult | null, form: FormData) => {
      const r = await action(form);
      return r;
    },
    null,
  );

  return (
    <form action={submit} className="space-y-4">
      <input type="hidden" name="portfolioId" value={portfolioId} />

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>Ticker</span>
          <input
            name="underlying"
            required
            autoComplete="off"
            spellCheck={false}
            className={`${field} w-28 uppercase`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Company</span>
          <input name="companyName" className={`${field} w-52`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Date added</span>
          <input
            name="openedAt"
            type="date"
            className={`${field} w-40 [color-scheme:dark]`}
          />
        </label>
        {!isOption && (
          <label className="flex flex-col gap-1">
            <span className={label}>Entry price</span>
            <input
              name="entryPrice"
              required
              inputMode="decimal"
              className={`${field} w-28`}
            />
          </label>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-300">
        <input
          type="checkbox"
          checked={isOption}
          onChange={(e) => {
            setIsOption(e.target.checked);
            setLegs([blankLeg()]);
          }}
          className="h-4 w-4 rounded border-gray-600 bg-gray-800"
        />
        This is an options trade
      </label>

      {isOption && (
        <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-950/60 p-3">
          {legs.map((leg, i) => (
            <div key={leg.id} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="legKind" value="OPTION" />
              <span className="pb-2 text-xs text-gray-600">Leg {i + 1}</span>
              <label className="flex flex-col gap-1">
                <span className={label}>Buy / sell</span>
                <select
                  name="legSide"
                  defaultValue={leg.side}
                  className={`${field} w-24`}
                >
                  <option value="BUY">Buy</option>
                  <option value="SELL">Sell</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>Expiry</span>
                <input
                  name="legExpiry"
                  type="date"
                  required
                  className={`${field} w-40 [color-scheme:dark]`}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>Strike</span>
                <input
                  name="legStrike"
                  required
                  inputMode="decimal"
                  className={`${field} w-24`}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>Call / put</span>
                <select name="legRight" className={`${field} w-24`}>
                  <option value="CALL">Call</option>
                  <option value="PUT">Put</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>Price paid</span>
                <input
                  name="legPrice"
                  required
                  inputMode="decimal"
                  className={`${field} w-24`}
                />
              </label>
              <input type="hidden" name="legRatio" value="1" />
              {legs.length > 1 && (
                <button
                  type="button"
                  onClick={() => setLegs(legs.filter((l) => l.id !== leg.id))}
                  className="pb-2 text-xs text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setLegs([...legs, blankLeg()])}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            + Add another leg (for a spread)
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>Buy up to</span>
          <input
            name="buyUpToPrice"
            inputMode="decimal"
            className={`${field} w-28`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Stop-loss</span>
          <input
            name="stopLossPrice"
            inputMode="decimal"
            className={`${field} w-28`}
          />
        </label>
        <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
          <span className={label}>Comment</span>
          <input name="comment" className={field} />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Add position"}
        </button>
        {result && (
          <span
            className={`text-xs ${result.ok ? "text-green-400" : "text-red-400"}`}
            role="status"
          >
            {result.ok ? (result.message ?? "Saved.") : result.error}
          </span>
        )}
      </div>
    </form>
  );
}
