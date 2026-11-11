"use client";

import { useId, useState, useTransition } from "react";
import { Plus, QrCode } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SuggestionList, type Suggestion } from "@/components/ui/suggestion-list";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { cn, couponLabel, parseCouponValue } from "@/lib/utils";
import { createCouponAction, setCouponActiveAction, type CreatedCoupon } from "./actions";
import { CouponQr } from "./coupon-qr";

export type StaffCoupon = {
  id: string;
  code: string;
  kind: "percent" | "fixed";
  value: number;
  /** Username of who can use it; null while nobody has claimed it */
  owner: string | null;
  used: boolean;
  active: boolean;
  createdBy: string;
  createdAt: string;
};

type Person = { id: string; username: string; email: string | null };

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

function StatusBadge({ coupon }: { coupon: StaffCoupon }) {
  if (coupon.used) return <Badge variant="outline">Used</Badge>;
  if (!coupon.active) return <Badge variant="outline">Off</Badge>;
  if (coupon.owner) return <Badge variant="success">Ready to use</Badge>;
  return <Badge variant="highlight">Waiting for claim</Badge>;
}

export function CouponsClient({ coupons, people }: { coupons: StaffCoupon[]; people: Person[] }) {
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [showingQr, setShowingQr] = useState<StaffCoupon | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (coupon: StaffCoupon) => {
    startTransition(async () => {
      const result = await setCouponActiveAction(coupon.id, !coupon.active);
      if (!result.success) {
        toast(result.error, "error");
        return;
      }
      toast(`${coupon.code} turned ${coupon.active ? "off" : "on"}`, "success");
    });
  };

  return (
    <div className="w-full max-w-6xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl">Coupons</h1>
          <p className="mt-1 text-sm text-muted-foreground">One-time discounts. Give one to a person, or share a code they can claim. Every change is in the audit log.</p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-2">
          <Plus aria-hidden="true" className="h-4 w-4" /> New coupon
        </Button>
      </header>

      {coupons.length === 0 ? (
        <p className="receipt px-4 py-10 text-center text-sm text-muted-foreground">No coupons yet. Make one to give someone a discount.</p>
      ) : (
        <div className="receipt">
          <Table className="min-w-[680px]">
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Belongs to</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Made by</TableHead>
                <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {coupons.map((coupon) => (
                <TableRow key={coupon.id}>
                  <TableCell className={cn("font-mono text-[15px] font-bold tracking-wider", (!coupon.active || coupon.used) && "text-muted-foreground")}>{coupon.code}</TableCell>
                  <TableCell>{couponLabel(coupon)}</TableCell>
                  <TableCell className={cn(!coupon.owner && "text-muted-foreground")}>{coupon.owner ?? "Not claimed yet"}</TableCell>
                  <TableCell><StatusBadge coupon={coupon} /></TableCell>
                  <TableCell>
                    {coupon.createdBy}
                    <span className="block font-mono text-[13px] text-muted-foreground">{dateFormat.format(new Date(coupon.createdAt))}</span>
                  </TableCell>
                  <TableCell>
                    {!coupon.used && (
                      <div className="flex justify-end gap-2">
                        {!coupon.owner && coupon.active && (
                          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setShowingQr(coupon)} aria-label={`Show QR code for ${coupon.code}`}>
                            <QrCode aria-hidden="true" className="h-4 w-4" /> QR
                          </Button>
                        )}
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => toggle(coupon)}>
                          {coupon.active ? "Turn off" : "Turn on"}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {creating && <NewCouponDialog people={people} onClose={() => setCreating(false)} />}

      <Dialog
        open={showingQr !== null}
        onOpenChange={(open) => !open && setShowingQr(null)}
        title={showingQr ? `Coupon ${showingQr.code}` : ""}
        description={showingQr ? `${couponLabel(showingQr)}. The first person to scan it or type the code gets it.` : undefined}
      >
        {showingQr && <ClaimableCode code={showingQr.code} />}
      </Dialog>
    </div>
  );
}

// The code in big type plus its QR, for showing on a screen or printing
function ClaimableCode({ code }: { code: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <p className="font-mono text-4xl font-bold tracking-[0.2em]" aria-label={`Code ${code.split("").join(" ")}`}>{code}</p>
      <CouponQr code={code} />
    </div>
  );
}

function NewCouponDialog({ people, onClose }: { people: Person[]; onClose: () => void }) {
  const [value, setValue] = useState("");
  const [giveTo, setGiveTo] = useState<"anyone" | "person">("anyone");
  const [person, setPerson] = useState<Person | null>(null);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedCoupon | null>(null);
  const [pending, startTransition] = useTransition();

  const discount = parseCouponValue(value);
  const missingPerson = giveTo === "person" && !person;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!discount) {
      setError("Enter an amount like 50, or a percent like 10%.");
      return;
    }
    if (missingPerson) {
      setError("Pick who gets the coupon.");
      return;
    }
    setError("");
    startTransition(async () => {
      const result = await createCouponAction(value, giveTo === "person" ? person!.id : null);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setCreated(result.coupon);
    });
  };

  if (created) {
    return (
      <Dialog
        open
        onOpenChange={(open) => !open && onClose()}
        title={`${couponLabel(created)} coupon ready`}
        description={
          created.owner
            ? `Given to ${created.owner}. It shows up on their list, ready to use once.`
            : "Show this on screen, print it, or read out the code. The first person to claim it gets it, for one use."
        }
        footer={<Button onClick={onClose}>Done</Button>}
      >
        {created.owner ? (
          <p className="py-2 text-center font-mono text-4xl font-bold tracking-[0.2em]">{created.code}</p>
        ) : (
          <ClaimableCode code={created.code} />
        )}
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()} title="New coupon" description="The code is made for you. Each coupon can be used once.">
      <form onSubmit={submit} className="space-y-5 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="coupon-value">Discount</Label>
          <p id="coupon-value-hint" className="text-xs text-muted-foreground">Type 50 for ₱50 off, or 10% for 10% off.</p>
          <div className="flex items-center gap-3">
            <Input
              id="coupon-value"
              aria-describedby="coupon-value-hint"
              inputMode="decimal"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError("");
              }}
              placeholder="50 or 10%"
              autoComplete="off"
              autoFocus
              className="max-w-40 text-right tabular-nums"
            />
            <span aria-live="polite" className="text-sm font-semibold text-success">{discount && couponLabel(discount)}</span>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Who gets it</legend>
          <div role="group" aria-label="Who gets it" className="flex flex-wrap gap-2">
            {([["anyone", "Whoever claims the code"], ["person", "A specific person"]] as const).map(([option, label]) => (
              <button
                key={option}
                type="button"
                aria-pressed={giveTo === option}
                onClick={() => {
                  setGiveTo(option);
                  setError("");
                }}
                className={cn(
                  "inline-flex h-9 items-center rounded-control border px-3 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  giveTo === option ? "border-primary bg-primary text-primary-foreground" : "border-input text-foreground hover:bg-foreground/5",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {giveTo === "person" && <PersonPicker people={people} picked={person} onPick={setPerson} />}
        </fieldset>

        {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending || !value.trim() || missingPerson}>{pending ? "Making…" : "Make coupon"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

// Type-to-search for a user, same dropdown as the product merge picker
function PersonPicker({ people, picked, onPick }: { people: Person[]; picked: Person | null; onPick: (person: Person | null) => void }) {
  const [query, setQuery] = useState(picked?.username ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();

  const needle = query.trim().toLowerCase();
  const options: Suggestion[] = people
    .filter((p) => !needle || p.username.toLowerCase().includes(needle) || p.email?.toLowerCase().includes(needle))
    .slice(0, 6)
    .map((p) => ({ id: p.id, name: p.username, detail: p.email ?? undefined }));
  const listOpen = open && !picked && options.length > 0;

  const pick = (item: Suggestion) => {
    const person = people.find((p) => p.id === item.id);
    if (!person) return;
    onPick(person);
    setQuery(person.username);
    setOpen(false);
    setActiveIndex(-1);
  };

  return (
    <div className="relative">
      <Input
        value={query}
        placeholder="Search by name or email…"
        aria-label="Person who gets the coupon"
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listOpen}
        aria-controls={listOpen ? listId : undefined}
        aria-activedescendant={listOpen && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          onPick(null);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={(e) => {
          if (listOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActiveIndex((index) => (index + step + options.length) % options.length);
          } else if (listOpen && e.key === "Enter") {
            e.preventDefault();
            const item = options[activeIndex] ?? (options.length === 1 ? options[0] : undefined);
            if (item) pick(item);
          } else if (listOpen && e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
        }}
      />
      {listOpen && <SuggestionList id={listId} items={options} activeIndex={activeIndex} onSelect={pick} />}
    </div>
  );
}
