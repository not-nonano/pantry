import { auth } from "@/auth";
import { Order, AuditLog, Coupon } from "@/models";
import { connectMongo } from "@/lib/db/mongodb";
import { couponDiscount, currentLineTotal, currentUnitPrice, tierLabel, type PriceTier } from "@/lib/utils";
import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { revalidatePath } from "next/cache";

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const RECEIPT_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const publicId = formData.get("publicId") as string;
    const paidInCash = formData.get("paymentMethod") === "cash";
    // Cash payments carry no receipt
    const receiptUrl = paidInCash ? null : (formData.get("receiptUrl") as string);
    const receiptFile = paidInCash ? null : (formData.get("receipt") as File | null);

    if (!publicId) {
      return NextResponse.json({ error: "Public ID is required" }, { status: 400 });
    }

    await connectMongo();

    const order = await Order.findOne({ publicId }).populate("items.productId");
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Check if user is the author
    if (String(order.authorId) !== String((session.user as Record<string, unknown>).id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Archiving again would re-price a paid order at today's prices
    if (order.status === "archived") {
      return NextResponse.json({ error: "Order is already archived" }, { status: 409 });
    }

    if (receiptUrl && !receiptUrl.startsWith("https://")) {
      return NextResponse.json({ error: "Receipt link must start with https://" }, { status: 400 });
    }

    if (receiptFile && (!RECEIPT_TYPES[receiptFile.type] || receiptFile.size > MAX_RECEIPT_BYTES)) {
      return NextResponse.json({ error: "Receipt must be a PNG, JPEG, GIF or WebP image under 10 MB" }, { status: 400 });
    }

    const actorId = (session.user as Record<string, unknown>).id as string;

    // Use the coupon up now, atomically, so it can't pay for two lists.
    // shortcut: if saving the order fails after this, the coupon stays used; staff can give a new one if it ever happens
    if (order.coupon) {
      const redeemed = await Coupon.findOneAndUpdate(
        { code: order.coupon.code, active: true, owner: actorId, usedAt: null },
        { $set: { usedAt: new Date(), usedOn: publicId } },
      );
      if (!redeemed) {
        return NextResponse.json({ error: `Coupon ${order.coupon.code} can no longer be used. Remove it and try again.` }, { status: 409 });
      }
      await AuditLog.create({
        actorId,
        targetType: "coupon",
        targetId: String(redeemed._id),
        action: "coupon_redeem",
        after: { code: order.coupon.code, publicId },
        note: `Coupon ${order.coupon.code} used on order ${publicId}`,
      });
    }

    let finalReceiptUrl = receiptUrl || null;

    // Handle file upload
    if (receiptFile) {
      const bytes = await receiptFile.arrayBuffer();
      const buffer = Buffer.from(bytes);

      // Extension comes from the checked type, never from the user's filename
      const ext = RECEIPT_TYPES[receiptFile.type];
      const filename = `receipt-${publicId}-${Date.now()}.${ext}`;
      const dir = join(process.cwd(), "storage", "receipts");
      const path = join(dir, filename);

      await mkdir(dir, { recursive: true });
      await writeFile(path, buffer);
      
      // We will serve this through a new route /api/receipts/[filename]
      finalReceiptUrl = `/api/receipts/${filename}`;
    }

    // Freeze item prices and calculate order totals
    let orderSubtotal = 0;
    if (Array.isArray(order.items)) {
      for (const item of order.items) {
        const unitPrice = currentUnitPrice(item) ?? 0;
        // Bulk prices are frozen into the line total; unpriced lines count as zero, as before
        const lineTotal = currentLineTotal(item) ?? 0;

        item.unitPrice = unitPrice;
        item.lineTotal = lineTotal;
        item.bulkLabel = tierLabel((item.productId as { priceTiers?: PriceTier[] } | null)?.priceTiers);
        orderSubtotal += lineTotal;
      }
    }

    // Update order
    order.status = "archived";
    order.archivedAt = new Date();
    order.subtotal = orderSubtotal;
    order.discount = couponDiscount(order.coupon, orderSubtotal);
    order.total = orderSubtotal - order.discount;
    if (finalReceiptUrl) {
      order.receiptUrl = finalReceiptUrl;
    }
    order.paymentMethod = paidInCash ? "cash" : finalReceiptUrl ? "receipt" : null;

    await order.save();

    // Log the action
    await AuditLog.create({
      actorId,
      targetType: "order",
      targetId: publicId,
      action: "order_archive",
      note: `Archived order${paidInCash ? " paid in cash" : finalReceiptUrl ? " with receipt" : ""}`,
    });

    revalidatePath("/");
    revalidatePath(`/order-list/${publicId}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Archive error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
