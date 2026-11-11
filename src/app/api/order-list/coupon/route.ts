import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { errorResponse } from "@/lib/api-errors";
import { setOrderCoupon } from "@/lib/pantry-db";

// Apply a coupon to the caller's open list; an empty code removes it
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { publicId?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const publicId = String(body.publicId ?? "").trim();
  const code = String(body.code ?? "").trim().slice(0, 32);
  if (!publicId) {
    return NextResponse.json({ error: "Public ID is required" }, { status: 400 });
  }

  try {
    const coupon = await setOrderCoupon(publicId, session.user.id as string, code);
    return NextResponse.json({ coupon });
  } catch (error) {
    return errorResponse(error, "Unable to apply coupon");
  }
}
