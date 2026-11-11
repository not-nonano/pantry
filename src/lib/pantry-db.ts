import { AuditLog, Coupon, Order, Product, User } from "@/models";
import { randomBytes, randomInt } from "crypto";
import { isValidObjectId } from "mongoose";

import { connectMongo } from "./db/mongodb";
import { couponDiscount, couponLabel, currentLineTotal, parseCouponValue, currentUnitPrice, escapeRegex, tierLabel, type CouponSnapshot, type PriceTier } from "./utils";
import type { MarketItem, OrderHistoryEntry, SharedOrderView, WorkspaceSession } from "./pantry-types";

type LeanOrderItem = {
  _id?: unknown;
  itemName?: string | null;
  quantity?: number | null;
  quantityLabel?: string | null;
  unit?: string | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
  status?: "draft" | "priced" | null;
};

type LeanOrder = {
  _id?: unknown;
  publicId: string;
  authorId?: unknown;
  title?: string | null;
  items?: LeanOrderItem[] | null;
  status?: "draft" | "archived" | null;
  updatedAt?: Date | string | number | null;
  createdAt?: Date | string | number | null;
  subtotal?: number | null;
  total?: number | null;
};

// Users shop in the Philippines; the server's own clock may be UTC
const TIME_ZONE = "Asia/Manila";

function formatPeso(amount: number | null) {
  if (amount === null || Number.isNaN(amount)) {
    return "Pending";
  }

  return `₱${amount.toFixed(amount % 1 === 0 ? 0 : 2)}`;
}

function formatRelativeDate(value: Date | string | number | null | undefined) {
  if (!value) {
    return "Just now";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Just now";
  }

  const deltaMinutes = Math.round((date.getTime() - Date.now()) / 60000);
  const absMinutes = Math.abs(deltaMinutes);

  if (absMinutes < 60) {
    return deltaMinutes >= 0 ? "Just now" : `${absMinutes}m ago`;
  }

  const hours = Math.round(absMinutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function codedError(code: string, message = code) {
  return Object.assign(new Error(message), { code });
}

// One rule for item input, whether it starts a list or joins one
function cleanItemName(itemName: string) {
  const clean = String(itemName ?? "").trim();
  if (clean.length < 2) {
    throw codedError("ITEM_NAME_TOO_SHORT", "Item name must be at least 2 characters");
  }
  return clean;
}

function cleanQuantityLabel(quantityLabel: string) {
  const clean = String(quantityLabel ?? "").trim();
  if (!clean) {
    throw codedError("QUANTITY_LABEL_TOO_SHORT", "Quantity label is required");
  }
  return clean;
}

// Owner-only writes; archived (paid) orders are locked
function assertCanEdit(order: { authorId?: unknown; status?: string | null }, userId: string) {
  if (!order.authorId || String(order.authorId) !== String(userId)) {
    throw codedError("FORBIDDEN", "Forbidden");
  }
  if (order.status === "archived") {
    throw codedError("ORDER_LOCKED", "This order is archived and can no longer change");
  }
}

// Items are addressed by position; the name the user saw guards against a list that changed in another tab
function itemAt<T extends { itemName?: string | null }>(order: { items?: T[] }, itemIndex: number, itemName: string): T {
  const item = Array.isArray(order.items) ? order.items[itemIndex] : undefined;
  if (!item) {
    throw codedError("ITEM_NOT_FOUND");
  }
  if (item.itemName !== itemName) {
    throw codedError("ITEM_CHANGED", "This list changed. Refresh and try again.");
  }
  return item;
}

function toSessionRow(order: LeanOrder) {
  return {
    id: String(order._id ?? order.publicId),
    publicId: order.publicId,
    title: order.title || `Order ${order.publicId}`,
    // Archiving is how an order gets paid
    preview: order.status === "archived" ? "Paid" : "Draft",
    items: `${Array.isArray(order.items) ? order.items.length : 0} items`,
    updated: formatRelativeDate(order.updatedAt ?? order.createdAt),
    status: order.status || "draft",
  };
}

export async function getOverviewSessions(userId?: string): Promise<WorkspaceSession[]> {
  // Orders are private: signed-out visitors have no list of their own
  if (!userId) {
    return [];
  }

  await connectMongo();
  const orders = await Order.find({ authorId: userId }, { publicId: 1, title: 1, items: 1, status: 1, updatedAt: 1, createdAt: 1 })
    .sort({ updatedAt: -1 })
    .limit(6)
    .lean();

  return orders.map((order: LeanOrder, index: number) => ({
    ...toSessionRow(order),
    active: order.status === "draft" || index === 0,
  }));
}

export async function getMarketItems(): Promise<MarketItem[]> {
  await connectMongo();

  const products = await Product.find({ active: true }, { name: 1, price: 1, priceTiers: 1, active: 1, notes: 1, aliases: 1 })
    .sort({ updatedAt: -1 })
    .lean();

  return products.map((product: Record<string, unknown>, index: number) => ({
    id: String(product._id ?? index),
    name: String(product.name ?? ""),
    price: [formatPeso(product.price as number | null ?? null), tierLabel(product.priceTiers as PriceTier[] | undefined)].filter(Boolean).join(" · "),
    status: (product.active as boolean | null) ? (product.price === null ? "Draft" : "Active") : "Archived",
    note: String(product.notes || ((product.active as boolean | null) ? "" : "Archived")),
    aliases: Array.isArray(product.aliases) ? product.aliases.map((a: Record<string, unknown>) => a.value as string) : [],
  }));
}

export async function getMarketItemMetrics() {
  await connectMongo();

  const products = await Product.find({ active: true }, { price: 1 }).lean();
  
  let valuated = 0;
  let pending = 0;

  for (const product of products) {
    if (typeof product.price === "number" && product.price > 0) {
      valuated++;
    } else {
      pending++;
    }
  }

  return {
    total: products.length,
    pending,
    valuated
  };
}

async function getOrCreateProduct(itemName: string) {
  const name = itemName.trim();
  const normalizedName = name.toLowerCase();

  const matched = await Product.findOne({ $or: [{ normalizedName }, { "aliases.value": normalizedName }], active: true });
  // One atomic write, so two people adding the same new item at once share one product
  return matched ?? Product.findOneAndUpdate(
    { normalizedName },
    { $set: { active: true }, $setOnInsert: { name } },
    { upsert: true, returnDocument: "after" },
  );
}

export async function getSharedOrder(publicId: string, userId?: string, viewerRole?: string): Promise<SharedOrderView> {
  await connectMongo();

  const order = (await Order.findOne({ publicId }).populate("items.productId").lean()) as Record<string, unknown> | null;
  if (!order) {
    throw codedError("ORDER_NOT_FOUND");
  }

  const orderAuthorId = order.authorId ? String(order.authorId) : null;
  const isAuthor = !!(userId && orderAuthorId && orderAuthorId === String(userId));
  
  // Only the owner and staff (who price and review orders) may open an order
  const isStaff = viewerRole === "admin" || viewerRole === "cashier";
  if (!isAuthor && !isStaff) {
    throw codedError("ORDER_FORBIDDEN");
  }

  const orderItems = order.items as Record<string, unknown>[] | null;
  const items = Array.isArray(orderItems)
    ? orderItems.map((item: Record<string, unknown>, index: number) => {
        const quantityLabel = item.quantityLabel ?? `${item.quantity ?? 0}${item.unit ? ` ${item.unit}` : ""}`.trim();
        
        // Archived orders keep the prices they were paid at
        const paid = order.status === "archived" && typeof item.unitPrice === "number";
        const unitPrice = paid ? (item.unitPrice as number) : currentUnitPrice(item);
        // Paid lines use the frozen total (bulk prices included); older records without one fall back to unit x quantity
        const quantity = typeof item.quantity === "number" ? item.quantity : 1;
        const lineTotal = paid ? Number(item.lineTotal) || (item.unitPrice as number) * quantity : currentLineTotal(item) ?? 0;
        const product = item.productId as { priceTiers?: PriceTier[] } | null;

        return {
          id: String(item._id ?? index),
          itemName: (item.itemName as string) || "Unnamed item",
          quantityLabel: quantityLabel as string,
          unitPrice,
          lineTotal,
          bulkLabel: paid ? String(item.bulkLabel ?? "") : tierLabel(product?.priceTiers),
          status: (item.status as "draft" | "priced") ?? "draft",
        };
      })
    : [];

  const isPaid = order.status === "archived";
  const coupon = (order.coupon as CouponSnapshot | null) ?? null;
  const subtotal = isPaid && typeof order.subtotal === "number" ? order.subtotal : items.reduce((sum: number, item: { lineTotal: number }) => sum + item.lineTotal, 0);
  const discount = isPaid ? Number(order.discount) || 0 : couponDiscount(coupon, subtotal);
  const total = isPaid && typeof order.total === "number" ? order.total : subtotal - discount;

  return {
    publicId: order.publicId as string,
    title: (order.title as string | null) || `Order ${order.publicId as string}`,
    createdAtLabel: formatRelativeDate(order.createdAt as Date | string | number),
    updatedAtLabel: formatRelativeDate(order.updatedAt as Date | string | number),
    archivedAtLabel: order.archivedAt ? formatRelativeDate(order.archivedAt as Date | string | number) : null,
    items,
    subtotal,
    discount,
    coupon: coupon ? { code: coupon.code, kind: coupon.kind, value: coupon.value } : null,
    total,
    receiptUrl: (order.receiptUrl as string) || null,
    paymentMethod: (order.paymentMethod as "cash" | "receipt" | null) ?? null,
    status: (order.status as "draft" | "archived") ?? "draft",
    isAuthor,
  };
}

export async function appendOrderItem(publicId: string, userId: string, itemName: string, quantityLabel: string) {
  await connectMongo();

  const name = cleanItemName(itemName);
  const label = cleanQuantityLabel(quantityLabel);

  const order = await Order.findOne({ publicId });
  if (!order) {
    throw codedError("ORDER_NOT_FOUND");
  }

  assertCanEdit(order, userId);

  const parsedQuantity = parseInt(label, 10);
  const quantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1;

  const matchedProduct = await getOrCreateProduct(name);

  // Same product already on the list: add to its quantity instead of a duplicate row.
  const existing = order.items.find(
    (entry: Record<string, unknown>) => String(entry.productId) === String(matchedProduct._id)
  ) as Record<string, unknown> | undefined;
  if (existing) {
    const oldQuantityLabel = String(existing.quantityLabel ?? "").trim();
    const newQuantity = (Number(existing.quantity) || 0) + quantity;
    existing.quantity = newQuantity;
    existing.quantityLabel = String(newQuantity);
    existing.lineTotal = typeof existing.unitPrice === "number" ? existing.unitPrice * newQuantity : 0;
    order.markModified("items");
    await order.save();

    await AuditLog.create({
      actorId: userId,
      targetType: "order",
      targetId: publicId,
      action: "quantity_update",
      before: { itemName: existing.itemName, quantityLabel: oldQuantityLabel },
      after: { itemName: existing.itemName, quantityLabel: existing.quantityLabel },
      note: `Added ${quantity} to ${existing.itemName}`,
    });

    return {
      id: String(existing._id ?? order.items.indexOf(existing)),
      itemName: String(existing.itemName),
      quantityLabel: String(existing.quantityLabel),
      unitPrice: (existing.unitPrice as number | undefined) ?? null,
      lineTotal: Number(existing.lineTotal) || 0,
      status: (existing.status as string | undefined) ?? "draft",
    };
  }

  const item = {
    productId: matchedProduct._id,
    itemName: matchedProduct.name,
    normalizedItemName: matchedProduct.normalizedName,
    quantity,
    quantityLabel: label,
    unit: matchedProduct.unit || "",
    unitPrice: matchedProduct.price,
    lineTotal: typeof matchedProduct.price === "number" ? matchedProduct.price * quantity : 0,
    status: typeof matchedProduct.price === "number" ? "priced" as const : "draft" as const,
  };

  order.items.push(item);
  order.markModified("items");
  await order.save();

  await AuditLog.create({
    actorId: userId,
    targetType: "order",
    targetId: publicId,
    action: "item_add",
    after: {
      itemName: matchedProduct.name,
      quantityLabel: item.quantityLabel,
    },
    note: `Added ${matchedProduct.name}`,
  });

  const inserted = order.items[order.items.length - 1];
  const result = {
    id: String(inserted._id ?? order.items.length - 1),
    itemName: inserted.itemName,
    quantityLabel: inserted.quantityLabel,
    unitPrice: inserted.unitPrice ?? null,
    lineTotal: inserted.lineTotal ?? 0,
    status: inserted.status ?? "draft",
  };

  return result;
}

export async function updateOrderItemQuantity(publicId: string, userId: string, itemIndex: number, itemName: string, quantityLabel: string) {
  await connectMongo();

  const label = cleanQuantityLabel(quantityLabel);

  const order = await Order.findOne({ publicId });
  if (!order) {
    throw codedError("ORDER_NOT_FOUND");
  }

  assertCanEdit(order, userId);
  const item = itemAt(order, itemIndex, itemName) as Record<string, unknown>;
  const oldQuantityLabel = String(item.quantityLabel ?? "").trim();
  item.quantityLabel = label;

  const parsedQuantity = parseInt(label, 10);
  if (Number.isFinite(parsedQuantity) && parsedQuantity > 0) {
    item.quantity = parsedQuantity;
  }

  order.markModified("items");
  await order.save();

  await AuditLog.create({
    actorId: userId,
    targetType: "order",
    targetId: publicId,
    action: "quantity_update",
    before: {
      itemName: item.itemName,
      quantityLabel: oldQuantityLabel,
    },
    after: {
      itemName: item.itemName,
      quantityLabel: item.quantityLabel,
    },
    note: `Updated quantity for ${item.itemName}`,
  });

  const result = {
    id: String(item._id ?? itemIndex),
    itemName: item.itemName,
    quantityLabel: item.quantityLabel,
    unitPrice: item.unitPrice ?? null,
    lineTotal: item.lineTotal ?? 0,
    status: item.status ?? "draft",
  };

  return result;
}

export async function removeOrderItem(publicId: string, userId: string, itemIndex: number, itemName: string) {
  await connectMongo();

  const order = await Order.findOne({ publicId });
  if (!order) throw codedError("ORDER_NOT_FOUND");

  assertCanEdit(order, userId);
  const removedItem = itemAt(order, itemIndex, itemName) as Record<string, unknown>;
  order.items.splice(itemIndex, 1);
  order.markModified("items");
  await order.save();

  await AuditLog.create({
    actorId: userId,
    targetType: "order",
    targetId: publicId,
    action: "item_remove",
    before: {
      itemName: removedItem.itemName,
      quantityLabel: removedItem.quantityLabel,
      // Store full item data to allow undo
      fullItem: removedItem, 
      index: itemIndex
    },
    note: `Removed ${removedItem.itemName}`,
  });

  return true;
}

export async function undoRemoveOrderItem(publicId: string, userId: string, auditLogId: string) {
  await connectMongo();

  const auditLog = await AuditLog.findById(auditLogId);
  if (!auditLog || auditLog.action !== "item_remove" || String(auditLog.targetId) !== publicId) {
    throw codedError("INVALID_AUDIT_LOG");
  }

  const order = await Order.findOne({ publicId });
  if (!order) throw codedError("ORDER_NOT_FOUND");

  const user = await User.findById(userId).lean();
  const isAdmin = user?.role === "admin";

  if (!isAdmin && (!order.authorId || String(order.authorId) !== String(userId))) {
    throw codedError("FORBIDDEN");
  }
  // An admin removed it because the product was deleted; only an admin may bring it back
  if (!isAdmin && (auditLog.before as { isAdminRemove?: boolean } | null)?.isAdminRemove) {
    throw codedError("FORBIDDEN");
  }
  if (order.status === "archived") {
    throw codedError("ORDER_LOCKED");
  }

  // Claim the log entry first so a double tap can't restore the item twice
  const claimed = await AuditLog.findOneAndDelete({ _id: auditLogId, action: "item_remove" });
  if (!claimed) {
    throw codedError("ALREADY_UNDONE");
  }

  const { fullItem, index } = claimed.before as { fullItem: Record<string, unknown>; index: number };
  
  // Re-insert the item at the original index
  order.items.splice(index, 0, fullItem);
  order.markModified("items");
  await order.save();

  await AuditLog.create({
    actorId: userId,
    targetType: "order",
    targetId: publicId,
    action: "item_undo_remove",
    after: {
      itemName: fullItem.itemName,
      quantityLabel: fullItem.quantityLabel,
    },
    note: `Undid removal of ${fullItem.itemName}`,
  });

  return true;
}

export async function getOrderHistory(publicId: string): Promise<OrderHistoryEntry[]> {
  await connectMongo();

  const auditLogs = await AuditLog.find({ targetType: "order", targetId: publicId }, { action: 1, note: 1, createdAt: 1, after: 1, before: 1 })
    .sort({ createdAt: -1 })
    .limit(12)
    .lean();

  return auditLogs.map((entry: Record<string, unknown>) => {
    const after = (entry.after ?? {}) as Record<string, unknown>;
    const before = (entry.before ?? {}) as Record<string, unknown>;
    return {
      id: String(entry._id),
      // en-CA formats as YYYY-MM-DD
      date: new Date((entry.createdAt as string | number | Date) ?? Date.now()).toLocaleDateString("en-CA", { timeZone: TIME_ZONE }),
      item: String(after.itemName || before.itemName || after.productName || entry.note || "Order update"),
      quantity: String(after.quantityLabel || before.quantityLabel || after.quantity || "-"),
      action: String(entry.action).replace(/_/g, " ").replace(/\b\w/g, (char: string) => char.toUpperCase()),
      rawAction: String(entry.action),
      isAdminRemove: before.isAdminRemove === true,
    };
  });
}

export async function getLatestOrderPublicId(userId?: string): Promise<string | null> {
  if (!userId) {
    return null;
  }

  await connectMongo();

  const latestOrder = await Order.findOne({ authorId: userId, status: { $ne: "archived" } }, { publicId: 1 })
    .sort({ updatedAt: -1 })
    .lean();

  return latestOrder?.publicId || null;
}

export async function createNewOrder(userId: string, itemName: string, quantityLabel: string) {
  // Check the first item before saving, so bad input can't leave an empty list behind
  const name = cleanItemName(itemName);
  const label = cleanQuantityLabel(quantityLabel);

  await connectMongo();

  const activeOrderError = "You already have an active order. Please archive it before creating a new one.";
  const existingActiveOrder = await Order.findOne({ authorId: userId, status: { $ne: "archived" } }).lean();
  if (existingActiveOrder) {
    throw new Error(activeOrderError);
  }

  const publicId = randomBytes(8).toString("base64url");
  const title = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: TIME_ZONE });

  try {
    await new Order({ publicId, authorId: userId, title, status: "draft" }).save();
  } catch (error) {
    // The one-open-order-per-user index catches a double submit that passed the check above
    const dup = error as { code?: number; keyPattern?: Record<string, unknown> };
    if (dup.code === 11000 && dup.keyPattern?.authorId) {
      throw new Error(activeOrderError);
    }
    throw error;
  }

  await appendOrderItem(publicId, userId, name, label);
  return publicId;
}

export async function getAllUsersWithOrderCounts() {
  await connectMongo();

  const [users, counts] = await Promise.all([
    User.find({}, { username: 1, email: 1, avatarUrl: 1, role: 1 }).lean(),
    Order.aggregate<{ _id: unknown; n: number }>([{ $group: { _id: "$authorId", n: { $sum: 1 } } }]),
  ]);
  const countByUser = new Map(counts.map((row) => [String(row._id), row.n]));

  return users.map((user: Record<string, unknown>) => ({
    id: String(user._id),
    username: String(user.username ?? ""),
    email: (user.email as string | null) ?? null,
    avatarUrl: (user.avatarUrl as string | null) ?? null,
    role: String(user.role ?? "user"),
    orderCount: countByUser.get(String(user._id)) ?? 0,
  }));
}

export async function getOrdersByUser(userId: string): Promise<WorkspaceSession[]> {
  await connectMongo();

  const orders = await Order.find({ authorId: userId })
    .sort({ updatedAt: -1 })
    .lean();

  return orders.map((order: LeanOrder) => ({ ...toSessionRow(order), active: false }));
}

export async function adminUpdateProduct(productId: string | null, data: Record<string, unknown>, adminUserId?: string) {
  await connectMongo();

  // Only these fields come from the client; schema checks run on update too
  const updateData: Record<string, unknown> = { active: true };

  if (typeof data.name === "string") {
    updateData.name = data.name.trim();
    updateData.normalizedName = data.name.trim().toLowerCase();
  }

  if (data.price !== undefined) {
    updateData.price = data.price;
  }

  if (data.priceTiers !== undefined) {
    updateData.priceTiers = cleanPriceTiers(data.priceTiers);
  }

  // Convert comma-separated aliases to the schema format if it's a string
  if (typeof data.aliases === "string") {
    updateData.aliases = data.aliases
      .split(",")
      .map((s: string) => s.trim().toLowerCase())
      .filter((s: string) => s.length > 0)
      .map((value: string) => ({ value, source: "manual" }));
  }

  if (productId) {
    const product = await Product.findByIdAndUpdate(productId, updateData, { returnDocument: "after", runValidators: true });
    
    // Sync price to draft orders if price was updated
    if (data.price !== undefined) {
      await Order.updateMany(
        { "items.productId": productId, status: "draft" },
        { 
          $set: { 
            "items.$[elem].unitPrice": data.price,
            "items.$[elem].status": data.price !== null ? "priced" : "draft"
          } 
        },
        { arrayFilters: [{ "elem.productId": productId }] }
      );
    }
    
    if (adminUserId && product) {
      await AuditLog.create({
        actorId: adminUserId,
        targetType: "product",
        targetId: productId,
        action: "product_update",
        after: updateData,
        note: `Admin updated product ${product.name}`
      });
    }

    return product;
  } else {
    const product = await Product.create(updateData);
    if (adminUserId) {
      await AuditLog.create({
        actorId: adminUserId,
        targetType: "product",
        targetId: String(product._id),
        action: "product_create",
        after: updateData,
        note: `Admin created product ${product.name}`
      });
    }
    return product;
  }
}

// Bulk prices come from the client: whole quantities of 2 or more, one price per quantity
export function cleanPriceTiers(raw: unknown): PriceTier[] {
  if (!Array.isArray(raw) || raw.length > 10) throw codedError("BAD_PRICE_TIERS", "Up to 10 bulk prices");
  const tiers = raw.map((t) => ({ qty: Number(t?.qty), price: Math.round(Number(t?.price) * 100) / 100 }));
  const seen = new Set<number>();
  for (const t of tiers) {
    if (!Number.isInteger(t.qty) || t.qty < 2 || !Number.isFinite(t.price) || t.price < 0 || seen.has(t.qty)) {
      throw codedError("BAD_PRICE_TIERS", "Each bulk price needs its own quantity of 2 or more and a price");
    }
    seen.add(t.qty);
  }
  return tiers.sort((a, b) => a.qty - b.qty);
}

// The list owner adds a coupon to their open list, or takes it off with an empty code
export async function setOrderCoupon(publicId: string, userId: string, code: string) {
  await connectMongo();

  const order = await Order.findOne({ publicId });
  if (!order) throw codedError("ORDER_NOT_FOUND");
  assertCanEdit(order, userId);

  const before = order.coupon ? { code: order.coupon.code } : null;
  const clean = String(code ?? "").trim().toUpperCase();

  if (!clean) {
    if (!order.coupon) return null;
    order.coupon = null;
    await order.save();
    await AuditLog.create({ actorId: userId, targetType: "order", targetId: publicId, action: "coupon_remove", before, note: `Removed coupon ${before?.code}` });
    return null;
  }

  // An open code becomes this user's on first use; someone else's coupon is refused
  const coupon = await claimCoupon(clean, userId);

  order.coupon = { code: coupon.code, kind: coupon.kind, value: coupon.value };
  await order.save();
  await AuditLog.create({
    actorId: userId,
    targetType: "order",
    targetId: publicId,
    action: "coupon_apply",
    before,
    after: { code: coupon.code, kind: coupon.kind, value: coupon.value },
    note: `Applied coupon ${coupon.code}`,
  });
  return order.coupon;
}

type LeanCoupon = { _id: unknown; code: string; kind: "percent" | "fixed"; value: number };

// No 0/O or 1/I/L, so a code read off a screen or paper is typed right the first time
const COUPON_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const COUPON_CODE_LENGTH = 6; // 31^6, about 887 million codes

function newCouponCode() {
  return Array.from({ length: COUPON_CODE_LENGTH }, () => COUPON_ALPHABET[randomInt(COUPON_ALPHABET.length)]).join("");
}

// Staff make a coupon: given straight to one user, or left open for the first person to claim the code
export async function createCoupon(staffId: string, rawValue: string, ownerId: string | null) {
  const discount = parseCouponValue(rawValue);
  if (!discount) throw codedError("BAD_COUPON_VALUE", "Enter an amount like 50, or a percent like 10%");

  await connectMongo();

  let owner: { _id: unknown; username: string } | null = null;
  if (ownerId) {
    owner = isValidObjectId(ownerId)
      ? await User.findOne({ _id: ownerId, isDeleted: { $ne: true } }, { username: 1 }).lean<{ _id: unknown; username: string }>()
      : null;
    if (!owner) throw codedError("USER_NOT_FOUND", "That user wasn't found");
  }

  // The unique index is the real check; a clash just rolls a new code
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCouponCode();
    try {
      const coupon = await Coupon.create({ code, ...discount, owner: owner?._id ?? null, claimedAt: owner ? new Date() : null, createdBy: staffId });
      await AuditLog.create({
        actorId: staffId,
        targetType: "coupon",
        targetId: String(coupon._id),
        action: "coupon_create",
        after: { code, ...discount, owner: owner?.username ?? null },
        note: owner ? `Gave coupon ${code} (${couponLabel(discount)}) to ${owner.username}` : `Made claimable coupon ${code} (${couponLabel(discount)})`,
      });
      return { id: String(coupon._id), code, ...discount, owner: owner?.username ?? null };
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }
  throw new Error("Couldn't make a unique coupon code");
}

// First claim wins, in one atomic write; claiming your own coupon again is fine
export async function claimCoupon(code: string, userId: string): Promise<LeanCoupon> {
  await connectMongo();
  const clean = String(code ?? "").trim().toUpperCase();

  const claimed = await Coupon.findOneAndUpdate(
    { code: clean, active: true, usedAt: null, owner: null },
    { $set: { owner: userId, claimedAt: new Date() } },
    { returnDocument: "after" },
  ).lean<LeanCoupon>();
  if (claimed) {
    await AuditLog.create({
      actorId: userId,
      targetType: "coupon",
      targetId: String(claimed._id),
      action: "coupon_claim",
      after: { code: claimed.code },
      note: `Claimed coupon ${claimed.code}`,
    });
    return claimed;
  }

  const mine = await Coupon.findOne({ code: clean, active: true, usedAt: null, owner: userId }).lean<LeanCoupon>();
  if (mine) return mine;
  throw codedError("COUPON_INVALID", "That coupon code isn't valid, or it was already claimed or used");
}

// Coupons the user can still use, for one-tap apply on their list
export async function getUserCoupons(userId: string) {
  await connectMongo();
  const rows = await Coupon.find({ owner: userId, active: true, usedAt: null }, { code: 1, kind: 1, value: 1 }).sort({ createdAt: -1 }).lean<LeanCoupon[]>();
  return rows.map((c) => ({ code: c.code, kind: c.kind, value: c.value }));
}

export async function adminMergeProducts(sourceId: string, targetId: string, adminUserId?: string) {
  await connectMongo();

  const source = await Product.findById(sourceId);
  const target = await Product.findById(targetId);

  if (!source || !target) throw new Error("Product not found");
  if (String(source._id) === String(target._id)) throw new Error("Cannot merge into itself");

  // Collect all unique alias values
  const aliasValues = new Set<string>();
  
  // Add source name as alias
  aliasValues.add(source.normalizedName);
  
  // Add source's existing aliases
  if (Array.isArray(source.aliases)) {
    source.aliases.forEach((a: Record<string, unknown>) => aliasValues.add(a.value as string));
  }
  
  // Add target's existing aliases
  if (Array.isArray(target.aliases)) {
    target.aliases.forEach((a: Record<string, unknown>) => aliasValues.add(a.value as string));
  }

  // Build new aliases array for target, excluding target's own name
  const finalAliases = Array.from(aliasValues)
    .filter(val => val !== target.normalizedName)
    .map(value => ({ value, source: "merge" }));

  target.aliases = finalAliases;
  await target.save();

  // Repoint open orders; paid (archived) orders keep their lines so they still match what was paid
  await Order.updateMany(
    { "items.productId": source._id, status: { $ne: "archived" } },
    { 
      $set: { 
        "items.$[elem].productId": target._id,
        "items.$[elem].itemName": target.name
      } 
    },
    { arrayFilters: [{ "elem.productId": source._id }] }
  );

  // Deactivate source
  source.active = false;
  await source.save();

  if (adminUserId) {
    await AuditLog.create({
      actorId: adminUserId,
      targetType: "product",
      targetId: targetId,
      action: "product_merge",
      before: { sourceId, sourceName: source.name },
      after: { targetId, targetName: target.name },
      note: `Admin merged product ${source.name} into ${target.name}`
    });
  }

  return true;
}

export async function adminDeleteProduct(productId: string, adminUserId?: string) {
  await connectMongo();

  const product = await Product.findByIdAndUpdate(productId, { active: false });
  if (!product) return null;

  if (adminUserId) {
    await AuditLog.create({
      actorId: adminUserId,
      targetType: "product",
      targetId: productId,
      action: "product_delete",
      before: { name: product.name, active: product.active },
      after: { active: false },
      note: `Admin soft-deleted product ${product.name}`
    });
  }

  // Remove this product from all orders that have it
  // Paid (archived) orders keep their lines so they still match what was paid
  const affectedOrders = await Order.find({ "items.productId": productId, status: { $ne: "archived" } });
  for (const order of affectedOrders) {
    const originalItems = order.items || [];
    let modified = false;
    const remainingItems = [];

    for (let i = 0; i < originalItems.length; i++) {
      const item = originalItems[i];
      if (String(item.productId) === String(productId)) {
        modified = true;
        if (adminUserId) {
          await AuditLog.create({
            actorId: adminUserId,
            targetType: "order",
            targetId: order.publicId,
            action: "item_remove",
            before: {
              itemName: item.itemName,
              quantityLabel: item.quantityLabel,
              fullItem: item,
              index: i,
              isAdminRemove: true
            },
            note: `Admin removed deleted product: ${item.itemName}`,
          });
        }
      } else {
        remainingItems.push(item);
      }
    }

    if (modified) {
      order.items = remainingItems;
      order.markModified("items");
      await order.save();
    }
  }

  return product;
}

export async function getAuditLogUsers() {
  await connectMongo();

  const distinctActorIds = await AuditLog.distinct("actorId");
  const users = await User.find({ _id: { $in: distinctActorIds } }, { username: 1, email: 1 }).lean();
  return JSON.parse(JSON.stringify(users));
}

export async function getPaginatedAuditLogs(
  page = 1, 
  limit = 20, 
  searchQuery = "", 
  selectedUsers: string[] = [], 
  selectedActions: string[] = []
) {
  await connectMongo();

  const query: Record<string, any> = {};

  if (searchQuery.trim()) {
    const q = escapeRegex(searchQuery.trim());
    const matchingUsers = await User.find({
      $or: [
        { username: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } }
      ]
    }, { _id: 1 }).lean();
    const userIds = matchingUsers.map((u: Record<string, unknown>) => u._id);

    query.$or = [
      { note: { $regex: q, $options: "i" } },
      { targetId: { $regex: q, $options: "i" } },
      { action: { $regex: q, $options: "i" } },
      { actorId: { $in: userIds } }
    ];
  }

  if (selectedUsers.length > 0) {
    query.actorId = { $in: selectedUsers };
  }

  if (selectedActions.length > 0) {
    query.action = { $in: selectedActions };
  }

  const skip = (page - 1) * limit;
  const logs = await AuditLog.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit + 1)
    .populate("actorId", "username email avatarUrl")
    .lean();

  const hasMore = logs.length > limit;
  const slicedLogs = hasMore ? logs.slice(0, limit) : logs;

  return {
    logs: JSON.parse(JSON.stringify(slicedLogs)),
    hasMore
  };
}
