// One rule for every place a password is set
export const MIN_PASSWORD_LENGTH = 8;

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
const money = new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Receipt-style amount: 1240 -> "1,240.00"
export function formatMoney(value: number) {
  return money.format(value);
}

// An open order follows the price list; without a product price, the price stored on the line
export function currentUnitPrice(item: { productId?: unknown; unitPrice?: unknown }) {
  const product = item.productId as { price?: unknown } | null | undefined;
  if (product && typeof product === "object" && typeof product.price === "number") return product.price;
  return typeof item.unitPrice === "number" ? item.unitPrice : null;
}

// Bulk price: "3 for ₱5" is { qty: 3, price: 5 }
export type PriceTier = { qty: number; price: number };

const cents = (value: number) => Math.round(value * 100) / 100;

// Biggest bundles first, like a cashier rings it up; leftovers at the unit price. No unit price, no total.
export function bundleTotal(unitPrice: number | null, tiers: PriceTier[] | null | undefined, quantity: number) {
  if (unitPrice === null) return null;
  let left = quantity;
  let total = 0;
  for (const tier of [...(tiers ?? [])].sort((a, b) => b.qty - a.qty)) {
    const bundles = Math.floor(left / tier.qty);
    total += bundles * tier.price;
    left -= bundles * tier.qty;
  }
  return cents(total + left * unitPrice);
}

// The open order's line total, following the product's current prices
export function currentLineTotal(item: { productId?: unknown; unitPrice?: unknown; quantity?: unknown }) {
  const product = item.productId as { priceTiers?: PriceTier[] } | null | undefined;
  const quantity = typeof item.quantity === "number" ? item.quantity : 1;
  return bundleTotal(currentUnitPrice(item), product && typeof product === "object" ? product.priceTiers : null, quantity);
}

export function tierLabel(tiers: PriceTier[] | null | undefined) {
  return (tiers ?? []).map((t) => `${t.qty} for ₱${formatMoney(t.price)}`).join(", ");
}

export type CouponSnapshot = { code: string; kind: "percent" | "fixed"; value: number };

// One box for the discount: "10%" is percent off, "50" or "₱50" is pesos off. null when it isn't a valid discount.
export function parseCouponValue(raw: string): { kind: "percent" | "fixed"; value: number } | null {
  const clean = String(raw ?? "").replace(/[₱,\s]/g, "");
  const percent = clean.endsWith("%");
  const value = Math.round(Number(percent ? clean.slice(0, -1) : clean) * 100) / 100;
  if (!clean || !Number.isFinite(value) || value <= 0 || (percent && value > 100)) return null;
  return { kind: percent ? "percent" : "fixed", value };
}

// A scanned QR holds a claim link (https://…/claim/K7M3QX); a bare code is accepted too. The server checks the code itself.
export function couponCodeFrom(scanned: string) {
  const text = String(scanned ?? "").trim();
  const match = text.match(/\/claim\/([A-Za-z0-9_-]{3,32})\/?(?:[?#].*)?$/) ?? text.match(/^([A-Za-z0-9_-]{3,32})$/);
  return match ? match[1].toUpperCase() : null;
}

export function couponLabel(coupon: { kind: "percent" | "fixed"; value: number }) {
  return coupon.kind === "percent" ? `${coupon.value}% off` : `₱${formatMoney(coupon.value)} off`;
}

// Never more than the subtotal, so a total can't go below zero
export function couponDiscount(coupon: CouponSnapshot | null | undefined, subtotal: number) {
  if (!coupon) return 0;
  const raw = coupon.kind === "percent" ? (subtotal * coupon.value) / 100 : coupon.value;
  return cents(Math.min(Math.max(raw, 0), subtotal));
}

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
