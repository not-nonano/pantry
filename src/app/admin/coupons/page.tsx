import { auth } from "@/auth";
import { redirect } from "next/navigation";

import { PantryLayout } from "@/components/pantry-layout";
import { connectMongo } from "@/lib/db/mongodb";
import { getMarketItems, getOverviewSessions } from "@/lib/pantry-db";
import { Coupon, User } from "@/models";
import { CouponsClient, type StaffCoupon } from "./CouponsClient";

export const metadata = { title: "Coupons | Admin" };

export default async function AdminCouponsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const role = session.user?.role;
  if (role !== "admin" && role !== "cashier") redirect("/unauthorized");

  await connectMongo();
  const [sessions, marketItems, rows, users] = await Promise.all([
    getOverviewSessions(session.user?.id),
    getMarketItems(),
    // shortcut: only the latest 500 coupons are shown; add paging if there are ever that many
    Coupon.find({}).sort({ createdAt: -1 }).limit(500).populate("owner", "username").populate("createdBy", "username").lean(),
    // People a coupon can be given to
    User.find({ isDeleted: { $ne: true }, isActive: { $ne: false } }, { username: 1, email: 1 }).sort({ username: 1 }).lean(),
  ]);

  const coupons: StaffCoupon[] = (rows as Record<string, unknown>[]).map((c) => ({
    id: String(c._id),
    code: String(c.code),
    kind: c.kind as StaffCoupon["kind"],
    value: Number(c.value),
    owner: (c.owner as { username?: string } | null)?.username ?? null,
    used: !!c.usedAt,
    active: c.active === true,
    createdBy: (c.createdBy as { username?: string } | null)?.username ?? "unknown",
    createdAt: (c.createdAt as Date).toISOString(),
  }));

  const people = (users as Record<string, unknown>[]).map((u) => ({
    id: String(u._id),
    username: String(u.username ?? ""),
    email: (u.email as string | null) ?? null,
  }));

  return (
    <PantryLayout active="overview" sessions={sessions} marketItems={marketItems} userRole={role} user={session.user as never}>
      <CouponsClient coupons={coupons} people={people} />
    </PantryLayout>
  );
}
