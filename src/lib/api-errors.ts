import { NextResponse } from "next/server";

// Error codes thrown by pantry-db, and the status each one answers with
const STATUS: Record<string, number> = {
  ITEM_NAME_TOO_SHORT: 400,
  BAD_PRICE_TIERS: 400,
  COUPON_INVALID: 400,
  QUANTITY_LABEL_TOO_SHORT: 400,
  FORBIDDEN: 403,
  ORDER_NOT_FOUND: 404,
  ITEM_NOT_FOUND: 404,
  INVALID_AUDIT_LOG: 404,
  ORDER_LOCKED: 409,
  ITEM_CHANGED: 409,
  ALREADY_UNDONE: 409,
};

// Known errors pass their message on; anything else is logged and hidden behind `fallback`
export function errorResponse(error: unknown, fallback: string) {
  const code = (error as { code?: unknown } | null)?.code;
  const status = typeof code === "string" ? STATUS[code] : undefined;
  if (!status) {
    console.error(fallback, error);
    return NextResponse.json({ error: fallback }, { status: 500 });
  }
  return NextResponse.json({ error: status === 403 ? "Unauthorized access" : (error as Error).message }, { status });
}
