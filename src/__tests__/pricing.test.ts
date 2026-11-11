import { describe, expect, it } from "vitest";
import { bundleTotal, couponCodeFrom, couponDiscount, currentLineTotal, parseCouponValue } from "../lib/utils";

describe("bundleTotal", () => {
  const tiers = [{ qty: 3, price: 5 }];

  it("charges the bundle price, then the unit price for leftovers", () => {
    expect(bundleTotal(1.5, tiers, 1)).toBe(1.5);
    expect(bundleTotal(1.5, tiers, 3)).toBe(5);
    expect(bundleTotal(1.5, tiers, 4)).toBe(6.5);
    expect(bundleTotal(1.5, tiers, 7)).toBe(11.5);
  });

  it("uses the biggest bundle first", () => {
    expect(bundleTotal(2, [{ qty: 3, price: 5 }, { qty: 10, price: 15 }], 14)).toBe(22); // 15 + 5 + 2
  });

  it("stays unpriced without a unit price", () => {
    expect(bundleTotal(null, tiers, 3)).toBeNull();
  });

  it("reads tiers from the populated product", () => {
    expect(currentLineTotal({ productId: { price: 1.5, priceTiers: tiers }, quantity: 4 })).toBe(6.5);
    expect(currentLineTotal({ productId: null, unitPrice: 2, quantity: 3 })).toBe(6);
  });
});

describe("couponDiscount", () => {
  it("takes a percent or a fixed amount, capped at the subtotal", () => {
    expect(couponDiscount({ code: "A", kind: "percent", value: 10 }, 250)).toBe(25);
    expect(couponDiscount({ code: "A", kind: "fixed", value: 50 }, 250)).toBe(50);
    expect(couponDiscount({ code: "A", kind: "fixed", value: 50 }, 30)).toBe(30);
    expect(couponDiscount(null, 30)).toBe(0);
  });
});

describe("parseCouponValue", () => {
  it("reads a percent when it ends in %, pesos otherwise", () => {
    expect(parseCouponValue("10%")).toEqual({ kind: "percent", value: 10 });
    expect(parseCouponValue(" 12.5 % ")).toEqual({ kind: "percent", value: 12.5 });
    expect(parseCouponValue("₱1,000")).toEqual({ kind: "fixed", value: 1000 });
    expect(parseCouponValue("50")).toEqual({ kind: "fixed", value: 50 });
  });

  it("rejects empty, zero, over 100% and junk", () => {
    for (const bad of ["", "0", "-5", "101%", "abc", "%"]) expect(parseCouponValue(bad)).toBeNull();
  });
});

describe("couponCodeFrom", () => {
  it("pulls the code out of a claim link or takes a bare code", () => {
    expect(couponCodeFrom("https://pantry.example/claim/K7M3QX")).toBe("K7M3QX");
    expect(couponCodeFrom("http://localhost:3000/claim/k7m3qx/?utm=1")).toBe("K7M3QX");
    expect(couponCodeFrom(" k7m3qx ")).toBe("K7M3QX");
  });

  it("ignores QR codes that aren't coupons", () => {
    expect(couponCodeFrom("https://example.com/menu")).toBeNull();
    expect(couponCodeFrom("WIFI:S:home;T:WPA;P:secret;;")).toBeNull();
  });
});
