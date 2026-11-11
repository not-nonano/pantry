"use server";

import { isValidObjectId } from "mongoose";
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { connectMongo } from "@/lib/db/mongodb";
import { createCoupon } from "@/lib/pantry-db";
import { AuditLog, Coupon } from "@/models";

// Same roles the /admin/coupons page lets in.
async function ensureStaff() {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "admin" && role !== "cashier") {
    throw new Error("Unauthorized");
  }
  return session?.user?.id as string;
}

export type CreatedCoupon = { id: string; code: string; kind: "percent" | "fixed"; value: number; owner: string | null };

// value is what staff typed: "50" for ₱50 off, "10%" for 10% off. ownerId gives it straight to that user.
export async function createCouponAction(value: string, ownerId: string | null): Promise<{ success: true; coupon: CreatedCoupon } | { success: false; error: string }> {
  try {
    const staffId = await ensureStaff();
    const coupon = await createCoupon(staffId, String(value ?? ""), ownerId || null);
    revalidatePath("/admin/coupons");
    return { success: true, coupon };
  } catch (error) {
    // Coded errors carry a message meant for staff; anything else stays in the server log
    if (typeof (error as { code?: unknown }).code === "string") return { success: false, error: (error as Error).message };
    console.error("Action error:", error);
    return { success: false, error: "Couldn't make the coupon. Try again." };
  }
}

// Coupons are turned off, never deleted, so the audit trail and paid orders still point at them
export async function setCouponActiveAction(id: string, active: boolean): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const staffId = await ensureStaff();
    if (!isValidObjectId(id)) return { success: false, error: "Bad id" };

    await connectMongo();
    const coupon = await Coupon.findByIdAndUpdate(id, { $set: { active: !!active } });
    if (!coupon) return { success: false, error: "Coupon not found" };

    await AuditLog.create({
      actorId: staffId,
      targetType: "coupon",
      targetId: id,
      action: "coupon_update",
      before: { active: coupon.active },
      after: { active: !!active },
      note: `${active ? "Turned on" : "Turned off"} coupon ${coupon.code}`,
    });
    revalidatePath("/admin/coupons");
    return { success: true };
  } catch (error) {
    console.error("Action error:", error);
    return { success: false, error: "Couldn't update the coupon. Try again." };
  }
}
