import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { PantryLayout } from "@/components/pantry-layout";
import { Button } from "@/components/ui/button";
import { connectMongo } from "@/lib/db/mongodb";
import { getLatestOrderPublicId, getMarketItems, getOverviewSessions } from "@/lib/pantry-db";
import { couponLabel } from "@/lib/utils";
import { Coupon } from "@/models";
import { claimCouponAction } from "./actions";

export const metadata = { title: "Claim coupon" };

type ClaimPageProps = { params: Promise<{ code: string }> };

// Where a coupon QR code leads. Claiming is a button press, not a page visit, so link previews can't claim it.
export default async function ClaimCouponPage({ params }: Readonly<ClaimPageProps>) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const userId = session.user.id;
  const code = decodeURIComponent((await params).code).trim().toUpperCase().slice(0, 32);

  await connectMongo();
  const [sessions, marketItems, openListId, coupon] = await Promise.all([
    getOverviewSessions(userId),
    getMarketItems(),
    getLatestOrderPublicId(userId),
    Coupon.findOne({ code }, { code: 1, kind: 1, value: 1, owner: 1, usedAt: 1, active: 1 }).lean<{
      code: string;
      kind: "percent" | "fixed";
      value: number;
      owner: unknown;
      usedAt: Date | null;
      active: boolean;
    }>(),
  ]);

  const mine = !!coupon?.owner && String(coupon.owner) === String(userId);
  let message: string;
  if (!coupon || !coupon.active) message = "This coupon isn't valid. Check the code with the cashier.";
  else if (coupon.usedAt) message = mine ? "You already used this coupon." : "This coupon has already been used.";
  else if (coupon.owner && !mine) message = "Someone else already claimed this coupon.";
  else if (mine) message = "It's yours. Apply it on your list before you pay.";
  else message = "Claim it and it's yours to use once, on any list.";

  const claimable = !!coupon && coupon.active && !coupon.usedAt && !coupon.owner;
  const ready = !!coupon && coupon.active && !coupon.usedAt && mine;

  return (
    <PantryLayout active="overview" sessions={sessions} marketItems={marketItems} userRole={session.user.role} user={session.user as never}>
      <section aria-labelledby="claim-title" className="receipt mx-auto w-full max-w-sm px-6 py-8 text-center">
        <p className="font-mono text-sm tracking-[0.2em] text-muted-foreground">{code}</p>
        <h1 id="claim-title" className="mt-2 font-display text-3xl">
          {coupon && coupon.active ? couponLabel(coupon) : "Coupon"}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground" role="status">{message}</p>

        {claimable && (
          <form action={claimCouponAction.bind(null, code)} className="mt-6">
            <Button type="submit" className="w-full">Claim coupon</Button>
          </form>
        )}
        {ready && (
          <Link
            href={openListId ? `/order-list/${openListId}` : "/"}
            className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-control bg-primary px-4 text-[15px] font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {openListId ? "Go to my list" : "Start a list"}
          </Link>
        )}
      </section>
    </PantryLayout>
  );
}
