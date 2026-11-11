"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { claimCoupon } from "@/lib/pantry-db";

export async function claimCouponAction(code: string) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  try {
    await claimCoupon(code, session.user.id);
  } catch (error) {
    // The page re-checks the coupon and explains what went wrong (claimed by someone else, used, turned off)
    if (typeof (error as { code?: unknown }).code !== "string") throw error;
  }
  revalidatePath(`/claim/${code}`);
  redirect(`/claim/${code}`);
}
