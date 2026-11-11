"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { couponLabel } from "@/lib/utils";
import { CouponScanButton } from "./coupon-scanner";

type CouponFieldProps = {
  publicId: string;
  appliedCode: string | null;
  /** Coupons this user claimed or was given and hasn't used yet */
  myCoupons: { code: string; kind: "percent" | "fixed"; value: number }[];
};

export function CouponField({ publicId, appliedCode, myCoupons }: Readonly<CouponFieldProps>) {
  const router = useRouter();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async (next: string) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/order-list/coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicId, code: next }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Couldn't apply the coupon. Try again.");
        return;
      }
      setCode("");
      toast(next ? `Coupon ${next.toUpperCase()} applied` : "Coupon removed", "success");
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (appliedCode) {
    return (
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>Coupon <strong className="font-mono">{appliedCode}</strong></span>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => send("")} aria-label={`Remove coupon ${appliedCode}`}>
          {busy ? "Removing…" : "Remove"}
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) send(code);
      }}
    >
      {myCoupons.length > 0 && (
        <div className="mb-3">
          <p className="text-sm font-semibold">Your coupons</p>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {myCoupons.map((c) => (
              <li key={c.code}>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => send(c.code)} aria-label={`Use coupon ${c.code}, ${couponLabel(c)}`}>
                  <span className="text-success">{couponLabel(c)}</span>
                  <span className="font-mono text-muted-foreground">{c.code}</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <label htmlFor="coupon-code" className="text-sm font-semibold">{myCoupons.length > 0 ? "Or enter a code" : "Coupon"}</label>
      <div className="mt-1.5 flex gap-2">
        <Input
          id="coupon-code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError("");
          }}
          placeholder="Enter code…"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={32}
          aria-invalid={!!error}
          aria-describedby={error ? "coupon-error" : undefined}
          className="font-mono uppercase"
        />
        <Button type="submit" variant="secondary" disabled={busy || !code.trim()}>
          {busy ? "Applying…" : "Apply"}
        </Button>
        <CouponScanButton disabled={busy} onCode={send} />
      </div>
      {error && <p id="coupon-error" role="alert" className="mt-1 text-xs font-semibold text-destructive">{error}</p>}
    </form>
  );
}
