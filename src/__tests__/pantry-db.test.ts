import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mongoose query stand-in: chainable methods, awaitable result.
function q<T>(result: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ["sort", "limit", "skip", "populate", "select", "lean"]) chain[m] = () => chain;
  chain.then = (res: (v: T) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return chain as never;
}

const m = vi.hoisted(() => {
  const orderSave = vi.fn();
  const Order = Object.assign(
    vi.fn(function (this: Record<string, unknown>, doc: Record<string, unknown>) {
      Object.assign(this, doc);
      this.save = orderSave;
    }),
    { findOne: vi.fn(), find: vi.fn(), updateMany: vi.fn(), aggregate: vi.fn() },
  );
  return {
    orderSave,
    Order,
    AuditLog: { create: vi.fn(), findById: vi.fn(), findOneAndDelete: vi.fn(), find: vi.fn(), distinct: vi.fn() },
    Product: { find: vi.fn(), findOne: vi.fn(), findOneAndUpdate: vi.fn(), findById: vi.fn(), findByIdAndUpdate: vi.fn(), create: vi.fn() },
    User: { findById: vi.fn(), find: vi.fn(), findOne: vi.fn() },
    Coupon: { findOne: vi.fn(), findOneAndUpdate: vi.fn(), create: vi.fn() },
    connectMongo: vi.fn(),
  };
});

vi.mock("../lib/db/mongodb", () => ({ connectMongo: m.connectMongo }));
vi.mock("../models", () => ({
  AuditLog: m.AuditLog,
  Order: m.Order,
  Product: m.Product,
  User: m.User,
  Coupon: m.Coupon,
}));

import * as db from "../lib/pantry-db";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

function orderDoc(overrides: Record<string, unknown> = {}) {
  return {
    publicId: "pub1",
    authorId: "user1",
    items: [] as Record<string, unknown>[],
    markModified: vi.fn(),
    save: vi.fn(),
    ...overrides,
  };
}

describe("pantry-db", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.connectMongo.mockResolvedValue(true);
  });

  it("lets a database outage surface instead of showing empty data", async () => {
    m.connectMongo.mockRejectedValueOnce(new Error("down"));
    await expect(db.getMarketItems()).rejects.toThrow("down");
  });

  describe("getOverviewSessions", () => {
    it("queries by author when a userId is given and maps sessions", async () => {
      m.Order.find.mockReturnValueOnce(
        q([
          { _id: "o1", publicId: "p1", title: "", items: [{}, {}], status: "archived", updatedAt: hoursAgo(2) },
          { _id: "o2", publicId: "p2", title: "T", items: null, status: "draft", createdAt: hoursAgo(48) },
        ]),
      );
      const res = await db.getOverviewSessions("u1");
      expect(m.Order.find.mock.calls[0][0]).toEqual({ authorId: "u1" });
      expect(res[0]).toMatchObject({
        id: "o1", title: "Order p1", preview: "Paid", items: "2 items", updated: "2h ago", active: true, status: "archived",
      });
      expect(res[1]).toMatchObject({ title: "T", preview: "Draft", items: "0 items", updated: "2d ago", active: true });
    });

    it("returns no orders when signed out, without querying", async () => {
      expect(await db.getOverviewSessions()).toEqual([]);
      expect(m.Order.find).not.toHaveBeenCalled();
    });
  });

  describe("getMarketItems", () => {
    it("formats price, status and aliases", async () => {
      m.Product.find.mockReturnValueOnce(
        q([
          { _id: "a", name: "Rice", price: 50, active: true, notes: "bag", aliases: [{ value: "bigas" }] },
          { _id: "b", name: "Egg", price: 7.5, active: true },
          { _id: "c", name: "Salt", price: null, active: true },
        ]),
      );
      const res = await db.getMarketItems();
      expect(res[0]).toEqual({ id: "a", name: "Rice", price: "₱50", status: "Active", note: "bag", aliases: ["bigas"] });
      expect(res[1]).toMatchObject({ price: "₱7.50", note: "", aliases: [] });
      expect(res[2]).toMatchObject({ price: "Pending", status: "Draft" });
    });
  });

  describe("getMarketItemMetrics", () => {
    it("counts priced vs pending products", async () => {
      m.Product.find.mockReturnValueOnce(q([{ price: 10 }, { price: 0 }, { price: null }, {}]));
      expect(await db.getMarketItemMetrics()).toEqual({ total: 4, pending: 3, valuated: 1 });
    });
  });

  describe("getSharedOrder", () => {
    it("throws ORDER_NOT_FOUND", async () => {
      m.Order.findOne.mockReturnValueOnce(q(null));
      await expect(db.getSharedOrder("p")).rejects.toThrow("ORDER_NOT_FOUND");
    });

    it("throws ORDER_FORBIDDEN for a signed-in customer who is not the author", async () => {
      m.Order.findOne.mockReturnValueOnce(q({ publicId: "p", authorId: "a" }));
      await expect(db.getSharedOrder("p", "b", "user")).rejects.toThrow("ORDER_FORBIDDEN");
    });

    it("throws ORDER_FORBIDDEN for a signed-out visitor, even on orders once marked public", async () => {
      m.Order.findOne.mockReturnValueOnce(q({ publicId: "p", authorId: "a", isPublic: true }));
      await expect(db.getSharedOrder("p")).rejects.toThrow("ORDER_FORBIDDEN");
    });

    it("lets a cashier view someone else's order", async () => {
      m.Order.findOne.mockReturnValueOnce(q({ publicId: "p", authorId: "a", status: "draft", items: [] }));
      const res = await db.getSharedOrder("p", "c", "cashier");
      expect(res.isAuthor).toBe(false);
    });

    it("lets the author view their order and uses live product prices", async () => {
      m.Order.findOne.mockReturnValueOnce(
        q({
          publicId: "p",
          authorId: "a",
          status: "draft",
          total: 999,
          items: [
            { _id: "i1", itemName: "Rice", quantity: 2, quantityLabel: "2", unitPrice: 10, productId: { price: 50 } },
            { itemName: "", quantity: 3, unit: "kg", unitPrice: 4, productId: null },
            { itemName: "Salt", productId: null },
          ],
        }),
      );
      const res = await db.getSharedOrder("p", "a");
      expect(res.isAuthor).toBe(true);
      expect(res.title).toBe("Order p");
      expect(res.items[0]).toMatchObject({ id: "i1", unitPrice: 50, lineTotal: 100, status: "draft" });
      expect(res.items[1]).toMatchObject({ id: "1", itemName: "Unnamed item", quantityLabel: "3 kg", unitPrice: 4, lineTotal: 12 });
      expect(res.items[2]).toMatchObject({ unitPrice: null, lineTotal: 0 });
      expect(res.subtotal).toBe(112);
      // Draft orders ignore stored totals.
      expect(res.total).toBe(112);
      expect(res.archivedAtLabel).toBeNull();
    });

    it("freezes unit prices and uses the stored total for archived orders", async () => {
      m.Order.findOne.mockReturnValueOnce(
        q({
          publicId: "p",
          authorId: "a",
          status: "archived",
          total: 30,
          archivedAt: new Date(),
          receiptUrl: "/r.jpg",
          items: [{ itemName: "Rice", quantity: 3, unitPrice: 10, productId: { price: 99 } }],
        }),
      );
      const res = await db.getSharedOrder("p", "admin1", "admin");
      expect(res.items[0]).toMatchObject({ unitPrice: 10, lineTotal: 30 });
      expect(res.total).toBe(30);
      expect(res.receiptUrl).toBe("/r.jpg");
      expect(res.archivedAtLabel).toBe("Just now");
      expect(res.isAuthor).toBe(false);
    });
  });

  describe("appendOrderItem", () => {
    it("adds to the quantity of an existing line for the same product", async () => {
      const order = orderDoc({ authorId: "u", items: [{ _id: "i1", productId: "prod", itemName: "Rice", quantity: 2, quantityLabel: "2", unitPrice: 40, lineTotal: 80, status: "priced" }] });
      m.Order.findOne.mockResolvedValueOnce(order);
      m.Product.findOne.mockResolvedValueOnce({ _id: "prod", name: "Rice", normalizedName: "rice", price: 50 });
      const res = await db.appendOrderItem("p", "u", "rice", "3");
      expect(order.items).toHaveLength(1);
      expect(order.items[0]).toMatchObject({ quantity: 5, quantityLabel: "5", lineTotal: 200 });
      expect(m.AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: "quantity_update" }));
      expect(res).toMatchObject({ id: "i1", quantityLabel: "5", lineTotal: 200 });
    });

    it("throws ORDER_NOT_FOUND", async () => {
      m.Order.findOne.mockResolvedValueOnce(null);
      await expect(db.appendOrderItem("p", "u", "Rice", "1")).rejects.toThrow("ORDER_NOT_FOUND");
    });

    it("throws FORBIDDEN for a non-author", async () => {
      m.Order.findOne.mockResolvedValueOnce(orderDoc({ authorId: "x" }));
      const err = await db.appendOrderItem("p", "u", "Rice", "1").catch((e) => e);
      expect(err.code).toBe("FORBIDDEN");
    });

    it("refuses to change an archived order", async () => {
      m.Order.findOne.mockResolvedValueOnce(orderDoc({ authorId: "u", status: "archived" }));
      const err = await db.appendOrderItem("p", "u", "Rice", "1").catch((e) => e);
      expect(err.code).toBe("ORDER_LOCKED");
    });

    it("adds a priced item from a matching product and logs it", async () => {
      const order = orderDoc({ authorId: "u" });
      m.Order.findOne.mockResolvedValueOnce(order);
      m.Product.findOne.mockResolvedValueOnce({ _id: "prod", name: "Rice", normalizedName: "rice", price: 50 });
      const res = await db.appendOrderItem("p", "u", " rice ", "3 kg");
      expect(order.items[0]).toMatchObject({ productId: "prod", itemName: "Rice", quantity: 3, quantityLabel: "3 kg", unitPrice: 50, lineTotal: 150, status: "priced" });
      expect(order.save).toHaveBeenCalled();
      expect(m.AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: "item_add", targetId: "p" }));
      expect(res).toMatchObject({ id: "0", itemName: "Rice", unitPrice: 50, lineTotal: 150, status: "priced" });
    });

    it("defaults quantity to 1 and creates or reactivates an unknown product in one atomic upsert", async () => {
      const order = orderDoc({ authorId: "u" });
      m.Order.findOne.mockResolvedValueOnce(order);
      m.Product.findOne.mockResolvedValueOnce(null);
      m.Product.findOneAndUpdate.mockResolvedValueOnce({ _id: "new", name: "Kale", normalizedName: "kale" });
      const res = await db.appendOrderItem("p", "u", "Kale", "a bunch");
      expect(m.Product.findOneAndUpdate).toHaveBeenCalledWith(
        { normalizedName: "kale" },
        { $set: { active: true }, $setOnInsert: { name: "Kale" } },
        { upsert: true, returnDocument: "after" },
      );
      expect(order.items[0]).toMatchObject({ quantity: 1, lineTotal: 0, status: "draft" });
      expect(res.unitPrice).toBeNull();
    });
  });

  describe("updateOrderItemQuantity", () => {
    it("throws ORDER_NOT_FOUND / FORBIDDEN / ITEM_NOT_FOUND", async () => {
      m.Order.findOne.mockResolvedValueOnce(null);
      await expect(db.updateOrderItemQuantity("p", "u", 0, "Rice", "1")).rejects.toThrow("ORDER_NOT_FOUND");
      m.Order.findOne.mockResolvedValueOnce(orderDoc({ authorId: "x" }));
      await expect(db.updateOrderItemQuantity("p", "u", 0, "Rice", "1")).rejects.toThrow("Forbidden");
      m.Order.findOne.mockResolvedValueOnce(orderDoc({ authorId: "u" }));
      await expect(db.updateOrderItemQuantity("p", "u", 5, "Rice", "1")).rejects.toThrow("ITEM_NOT_FOUND");
    });

    it("refuses when the item at that position is no longer the one the user saw", async () => {
      // Another tab removed an item, so position 0 now holds Egg
      const order = orderDoc({ authorId: "u", items: [{ itemName: "Egg", quantity: 1 }] });
      m.Order.findOne.mockResolvedValueOnce(order);
      const err = await db.updateOrderItemQuantity("p", "u", 0, "Rice", "5").catch((e) => e);
      expect(err.code).toBe("ITEM_CHANGED");
      expect(order.items[0].quantity).toBe(1);
      expect(order.save).not.toHaveBeenCalled();
    });

    it("refuses to change an archived order", async () => {
      m.Order.findOne.mockResolvedValueOnce(orderDoc({ authorId: "u", status: "archived", items: [{ itemName: "Rice" }] }));
      const err = await db.updateOrderItemQuantity("p", "u", 0, "Rice", "5").catch((e) => e);
      expect(err.code).toBe("ORDER_LOCKED");
    });

    it("updates label and parsed quantity, and logs before/after", async () => {
      const order = orderDoc({ authorId: "u", items: [{ itemName: "Rice", quantity: 1, quantityLabel: "1", unitPrice: 5 }] });
      m.Order.findOne.mockResolvedValueOnce(order);
      const res = await db.updateOrderItemQuantity("p", "u", 0, "Rice", "4 packs");
      expect(order.items[0]).toMatchObject({ quantity: 4, quantityLabel: "4 packs" });
      expect(m.AuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: "quantity_update", before: { itemName: "Rice", quantityLabel: "1" }, after: { itemName: "Rice", quantityLabel: "4 packs" } }),
      );
      expect(res).toMatchObject({ id: "0", unitPrice: 5, lineTotal: 0, status: "draft" });
    });

    it("keeps the old numeric quantity when the label is not a number", async () => {
      const order = orderDoc({ authorId: "u", items: [{ itemName: "Rice", quantity: 2 }] });
      m.Order.findOne.mockResolvedValueOnce(order);
      await db.updateOrderItemQuantity("p", "u", 0, "Rice", "some");
      expect(order.items[0].quantity).toBe(2);
    });
  });

  describe("removeOrderItem", () => {
    it("throws ORDER_NOT_FOUND", async () => {
      m.Order.findOne.mockResolvedValueOnce(null);
      await expect(db.removeOrderItem("p", "u", 0, "Rice")).rejects.toThrow("ORDER_NOT_FOUND");
    });

    it("removes the item and stores it for undo", async () => {
      const item = { itemName: "Rice", quantityLabel: "2" };
      const order = orderDoc({ authorId: "u", items: [{ itemName: "Egg" }, item] });
      m.Order.findOne.mockResolvedValueOnce(order);
      expect(await db.removeOrderItem("p", "u", 1, "Rice")).toBe(true);
      expect(order.items).toEqual([{ itemName: "Egg" }]);
      expect(m.AuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: "item_remove", before: { itemName: "Rice", quantityLabel: "2", fullItem: item, index: 1 } }),
      );
    });

    it("removes nothing when the item at that position changed", async () => {
      const order = orderDoc({ authorId: "u", items: [{ itemName: "Egg" }] });
      m.Order.findOne.mockResolvedValueOnce(order);
      const err = await db.removeOrderItem("p", "u", 0, "Rice").catch((e) => e);
      expect(err.code).toBe("ITEM_CHANGED");
      expect(order.items).toEqual([{ itemName: "Egg" }]);
    });
  });

  describe("undoRemoveOrderItem", () => {
    const log = { action: "item_remove", targetId: "p", before: { fullItem: { itemName: "Rice", quantityLabel: "2" }, index: 1 } };

    it("rejects a missing, wrong-action or wrong-order audit log", async () => {
      m.AuditLog.findById.mockResolvedValueOnce(null);
      await expect(db.undoRemoveOrderItem("p", "u", "l")).rejects.toThrow("INVALID_AUDIT_LOG");
      m.AuditLog.findById.mockResolvedValueOnce({ ...log, action: "item_add" });
      await expect(db.undoRemoveOrderItem("p", "u", "l")).rejects.toThrow("INVALID_AUDIT_LOG");
      m.AuditLog.findById.mockResolvedValueOnce({ ...log, targetId: "other" });
      await expect(db.undoRemoveOrderItem("p", "u", "l")).rejects.toThrow("INVALID_AUDIT_LOG");
    });

    it("throws ORDER_NOT_FOUND", async () => {
      m.AuditLog.findById.mockResolvedValueOnce(log);
      m.Order.findOne.mockResolvedValueOnce(null);
      await expect(db.undoRemoveOrderItem("p", "u", "l")).rejects.toThrow("ORDER_NOT_FOUND");
    });

    it("forbids non-author non-admins", async () => {
      m.AuditLog.findById.mockResolvedValueOnce(log);
      m.Order.findOne.mockResolvedValueOnce(orderDoc({ authorId: "x" }));
      m.User.findById.mockReturnValueOnce(q({ role: "user" }));
      await expect(db.undoRemoveOrderItem("p", "u", "l")).rejects.toThrow("FORBIDDEN");
    });

    it("only lets an admin undo a removal made by an admin", async () => {
      const adminLog = { ...log, before: { ...log.before, isAdminRemove: true } };
      m.AuditLog.findById.mockResolvedValueOnce(adminLog);
      m.Order.findOne.mockResolvedValueOnce(orderDoc({ authorId: "u" }));
      m.User.findById.mockReturnValueOnce(q({ role: "user" }));
      await expect(db.undoRemoveOrderItem("p", "u", "l")).rejects.toThrow("FORBIDDEN");
      expect(m.AuditLog.findOneAndDelete).not.toHaveBeenCalled();
    });

    it("re-inserts the item at its index and deletes the remove log", async () => {
      const order = orderDoc({ authorId: "x", items: [{ itemName: "A" }, { itemName: "B" }] });
      m.AuditLog.findById.mockResolvedValueOnce(log);
      m.Order.findOne.mockResolvedValueOnce(order);
      m.User.findById.mockReturnValueOnce(q({ role: "admin" }));
      m.AuditLog.findOneAndDelete.mockResolvedValueOnce(log);
      expect(await db.undoRemoveOrderItem("p", "admin1", "l")).toBe(true);
      expect(order.items.map((i) => i.itemName)).toEqual(["A", "Rice", "B"]);
      expect(m.AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: "item_undo_remove" }));
      expect(m.AuditLog.findOneAndDelete).toHaveBeenCalledWith({ _id: "l", action: "item_remove" });
    });

    it("restores nothing when the same undo already ran (double tap)", async () => {
      const order = orderDoc({ authorId: "u", items: [{ itemName: "A" }] });
      m.AuditLog.findById.mockResolvedValueOnce(log);
      m.Order.findOne.mockResolvedValueOnce(order);
      m.User.findById.mockReturnValueOnce(q({ role: "user" }));
      m.AuditLog.findOneAndDelete.mockResolvedValueOnce(null);
      await expect(db.undoRemoveOrderItem("p", "u", "l")).rejects.toThrow("ALREADY_UNDONE");
      expect(order.items).toEqual([{ itemName: "A" }]);
      expect(order.save).not.toHaveBeenCalled();
    });

    it("refuses on an archived order", async () => {
      m.AuditLog.findById.mockResolvedValueOnce(log);
      m.Order.findOne.mockResolvedValueOnce(orderDoc({ authorId: "u", status: "archived" }));
      m.User.findById.mockReturnValueOnce(q({ role: "user" }));
      await expect(db.undoRemoveOrderItem("p", "u", "l")).rejects.toThrow("ORDER_LOCKED");
      expect(m.AuditLog.findOneAndDelete).not.toHaveBeenCalled();
    });
  });

  describe("getOrderHistory", () => {
    it("returns [] when there are no logs", async () => {
      m.AuditLog.find.mockReturnValueOnce(q([]));
      expect(await db.getOrderHistory("p")).toEqual([]);
    });

    it("maps audit logs to history entries", async () => {
      m.AuditLog.find.mockReturnValueOnce(
        q([
          { _id: "l1", action: "item_add", createdAt: "2026-01-02T10:00:00Z", after: { itemName: "Rice", quantityLabel: "2" } },
          { _id: "l2", action: "item_remove", createdAt: "2026-01-01T10:00:00Z", before: { itemName: "Egg", isAdminRemove: true } },
          { _id: "l3", action: "order_archive", createdAt: "2026-01-01T10:00:00Z", note: "Archived order" },
        ]),
      );
      const res = await db.getOrderHistory("p");
      expect(res[0]).toEqual({ id: "l1", date: "2026-01-02", item: "Rice", quantity: "2", action: "Item Add", rawAction: "item_add", isAdminRemove: false });
      expect(res[1]).toMatchObject({ item: "Egg", quantity: "-", isAdminRemove: true });
      expect(res[2]).toMatchObject({ item: "Archived order", action: "Order Archive" });
    });
  });

  describe("getLatestOrderPublicId", () => {
    it("excludes archived orders and returns the publicId", async () => {
      m.Order.findOne.mockReturnValueOnce(q({ publicId: "p9" }));
      expect(await db.getLatestOrderPublicId("u")).toBe("p9");
      expect(m.Order.findOne.mock.calls[0][0]).toEqual({ authorId: "u", status: { $ne: "archived" } });
    });

    it("returns null when nothing is found", async () => {
      m.Order.findOne.mockReturnValueOnce(q(null));
      expect(await db.getLatestOrderPublicId("u")).toBeNull();
    });

    it("returns null when signed out, without querying", async () => {
      expect(await db.getLatestOrderPublicId()).toBeNull();
      expect(m.Order.findOne).not.toHaveBeenCalled();
    });
  });

  describe("createNewOrder", () => {
    it("refuses when the user already has an active order", async () => {
      m.Order.findOne.mockReturnValueOnce(q({ publicId: "existing" }));
      await expect(db.createNewOrder("u", "Rice", "1")).rejects.toThrow("already have an active order");
    });

    it("creates a draft order dated in Manila time, then adds the first item", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-28T23:30:00Z")); // 07:30 on Oct 29 in Manila
      let created: Record<string, any> = {};
      m.orderSave.mockImplementationOnce(function (this: Record<string, any>) {
        created = Object.assign(this, { items: [], markModified: vi.fn(), save: vi.fn() });
      });
      m.Order.findOne.mockReturnValueOnce(q(null)).mockImplementationOnce(async () => created);
      m.Product.findOne.mockResolvedValueOnce({ _id: "prod", name: "Rice", normalizedName: "rice", price: 20 });
      const publicId = await db.createNewOrder("u", "Rice", " 2 ");
      vi.useRealTimers();
      expect(publicId).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(m.Order.mock.calls[0][0]).toEqual({ publicId, authorId: "u", title: "October 29, 2026", status: "draft" });
      expect(created.items[0]).toMatchObject({ itemName: "Rice", quantity: 2, quantityLabel: "2", unitPrice: 20, lineTotal: 40, status: "priced" });
      expect(m.AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: "item_add", targetId: publicId }));
    });

    it("checks the first item like any other, before saving anything", async () => {
      const err = await db.createNewOrder("u", "x", "1").catch((e) => e);
      expect(err.code).toBe("ITEM_NAME_TOO_SHORT");
      await expect(db.createNewOrder("u", "Rice", "   ")).rejects.toThrow("Quantity label is required");
      expect(m.orderSave).not.toHaveBeenCalled();
    });

    it("reports the active-order error when a double submit hits the unique index", async () => {
      m.Order.findOne.mockReturnValueOnce(q(null));
      m.orderSave.mockRejectedValueOnce(Object.assign(new Error("E11000"), { code: 11000, keyPattern: { authorId: 1, status: 1 } }));
      await expect(db.createNewOrder("u", "Rice", "1")).rejects.toThrow("already have an active order");
      expect(m.AuditLog.create).not.toHaveBeenCalled();
    });
  });

  describe("getAllUsersWithOrderCounts", () => {
    it("attaches order counts", async () => {
      m.User.find.mockReturnValueOnce(q([{ _id: "u1", username: "ann" }, { _id: "u2", username: "bo" }]));
      m.Order.aggregate.mockResolvedValueOnce([{ _id: "u1", n: 3 }]);
      expect(await db.getAllUsersWithOrderCounts()).toEqual([
        { id: "u1", username: "ann", email: null, avatarUrl: null, role: "user", orderCount: 3 },
        { id: "u2", username: "bo", email: null, avatarUrl: null, role: "user", orderCount: 0 },
      ]);
      expect(m.Order.aggregate).toHaveBeenCalledTimes(1);
    });
  });

  describe("getOrdersByUser", () => {
    it("maps orders", async () => {
      m.Order.find.mockReturnValueOnce(q([{ _id: "o1", publicId: "p", status: "archived", items: [{}], updatedAt: new Date() }]));
      expect((await db.getOrdersByUser("u"))[0]).toMatchObject({
        id: "o1", title: "Order p", preview: "Paid", items: "1 items", active: false, status: "archived",
      });
    });
  });

  describe("adminUpdateProduct", () => {
    it("creates a product with normalized name and parsed aliases", async () => {
      m.Product.create.mockResolvedValueOnce({ _id: "p1", name: "Rice" });
      await db.adminUpdateProduct(null, { name: "Rice", aliases: " Bigas, , GRAIN " }, "admin");
      expect(m.Product.create).toHaveBeenCalledWith({
        name: "Rice",
        normalizedName: "rice",
        active: true,
        aliases: [{ value: "bigas", source: "manual" }, { value: "grain", source: "manual" }],
      });
      expect(m.AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: "product_create", targetId: "p1" }));
    });

    it("updates a product and syncs its price into draft orders", async () => {
      m.Product.findByIdAndUpdate.mockResolvedValueOnce({ name: "Rice" });
      await db.adminUpdateProduct("p1", { price: 55 }, "admin");
      expect(m.Order.updateMany).toHaveBeenCalledWith(
        { "items.productId": "p1", status: "draft" },
        { $set: { "items.$[elem].unitPrice": 55, "items.$[elem].status": "priced" } },
        { arrayFilters: [{ "elem.productId": "p1" }] },
      );
      expect(m.AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: "product_update" }));
    });

    it("writes only known fields and runs schema checks", async () => {
      m.Product.findByIdAndUpdate.mockResolvedValueOnce({ name: "Rice" });
      await db.adminUpdateProduct("p1", { price: -5, normalizedName: "x", notes: "y" });
      expect(m.Product.findByIdAndUpdate).toHaveBeenCalledWith(
        "p1",
        { active: true, price: -5 },
        { returnDocument: "after", runValidators: true },
      );
    });

    it("marks synced items as draft when price is cleared, and skips sync when price is untouched", async () => {
      m.Product.findByIdAndUpdate.mockResolvedValue({ name: "Rice" });
      await db.adminUpdateProduct("p1", { price: null });
      expect(m.Order.updateMany.mock.calls[0][1].$set["items.$[elem].status"]).toBe("draft");
      await db.adminUpdateProduct("p1", { notes: "x" });
      expect(m.Order.updateMany).toHaveBeenCalledTimes(1);
      expect(m.AuditLog.create).not.toHaveBeenCalled();
    });
  });

  describe("adminMergeProducts", () => {
    it("throws when a product is missing or merged into itself", async () => {
      m.Product.findById.mockResolvedValueOnce(null).mockResolvedValueOnce({ _id: "b" });
      await expect(db.adminMergeProducts("a", "b")).rejects.toThrow("Product not found");
      m.Product.findById.mockResolvedValueOnce({ _id: "a" }).mockResolvedValueOnce({ _id: "a" });
      await expect(db.adminMergeProducts("a", "a")).rejects.toThrow("Cannot merge into itself");
    });

    it("merges aliases, repoints orders and deactivates the source", async () => {
      const source = { _id: "a", name: "Bigas", normalizedName: "bigas", aliases: [{ value: "rice" }, { value: "grain" }], save: vi.fn(), active: true };
      const target = { _id: "b", name: "Rice", normalizedName: "rice", aliases: [{ value: "kanin" }], save: vi.fn() };
      m.Product.findById.mockResolvedValueOnce(source).mockResolvedValueOnce(target);
      expect(await db.adminMergeProducts("a", "b", "admin")).toBe(true);
      expect(target.aliases.map((a: { value: string }) => a.value).sort()).toEqual(["bigas", "grain", "kanin"]);
      expect(target.save).toHaveBeenCalled();
      expect(m.Order.updateMany).toHaveBeenCalledWith(
        { "items.productId": "a", status: { $ne: "archived" } },
        { $set: { "items.$[elem].productId": "b", "items.$[elem].itemName": "Rice" } },
        { arrayFilters: [{ "elem.productId": "a" }] },
      );
      expect(source.active).toBe(false);
      expect(source.save).toHaveBeenCalled();
      expect(m.AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: "product_merge" }));
    });
  });

  describe("adminDeleteProduct", () => {
    it("returns null when the product does not exist", async () => {
      m.Product.findByIdAndUpdate.mockResolvedValueOnce(null);
      expect(await db.adminDeleteProduct("x")).toBeNull();
    });

    it("soft-deletes and strips the product from orders with undo logs", async () => {
      const product = { name: "Rice", active: true };
      const order = orderDoc({ authorId: "u", items: [{ productId: "x", itemName: "Rice" }, { productId: "y", itemName: "Egg" }] });
      const untouched = orderDoc({ items: [{ productId: "y" }] });
      m.Product.findByIdAndUpdate.mockResolvedValueOnce(product);
      m.Order.find.mockResolvedValueOnce([order, untouched]);
      expect(await db.adminDeleteProduct("x", "admin")).toBe(product);
      expect(m.Product.findByIdAndUpdate).toHaveBeenCalledWith("x", { active: false });
      // Paid orders are left alone so they still match what was paid
      expect(m.Order.find).toHaveBeenCalledWith({ "items.productId": "x", status: { $ne: "archived" } });
      expect(order.items).toEqual([{ productId: "y", itemName: "Egg" }]);
      expect(order.save).toHaveBeenCalled();
      expect(untouched.save).not.toHaveBeenCalled();
      const actions = m.AuditLog.create.mock.calls.map((c) => c[0].action);
      expect(actions).toEqual(["product_delete", "item_remove"]);
      expect(m.AuditLog.create.mock.calls[1][0].before).toMatchObject({ index: 0, isAdminRemove: true });
    });
  });

  describe("getAuditLogUsers", () => {
    it("returns users who appear as audit actors", async () => {
      m.AuditLog.distinct.mockResolvedValueOnce(["u1"]);
      m.User.find.mockReturnValueOnce(q([{ _id: "u1", username: "ann" }]));
      expect(await db.getAuditLogUsers()).toEqual([{ _id: "u1", username: "ann" }]);
      expect(m.User.find.mock.calls[0][0]).toEqual({ _id: { $in: ["u1"] } });
    });
  });

  describe("getPaginatedAuditLogs", () => {
    it("fetches limit + 1 to compute hasMore", async () => {
      m.AuditLog.find.mockReturnValueOnce(q([{ _id: 1 }, { _id: 2 }, { _id: 3 }]));
      expect(await db.getPaginatedAuditLogs(1, 2)).toEqual({ logs: [{ _id: 1 }, { _id: 2 }], hasMore: true });
    });

    it("returns hasMore=false on the last page", async () => {
      m.AuditLog.find.mockReturnValueOnce(q([{ _id: 1 }]));
      expect(await db.getPaginatedAuditLogs(2, 2)).toEqual({ logs: [{ _id: 1 }], hasMore: false });
    });

    it("builds search and filter queries", async () => {
      m.User.find.mockReturnValueOnce(q([{ _id: "u1" }]));
      m.AuditLog.find.mockReturnValueOnce(q([]));
      await db.getPaginatedAuditLogs(1, 20, " ann ", ["u2"], ["item_add"]);
      const query = m.AuditLog.find.mock.calls[0][0];
      expect(query.$or).toContainEqual({ note: { $regex: "ann", $options: "i" } });
      expect(query.$or).toContainEqual({ actorId: { $in: ["u1"] } });
      expect(query.actorId).toEqual({ $in: ["u2"] });
      expect(query.action).toEqual({ $in: ["item_add"] });
    });

    it("treats search text literally, so a stray bracket can't break the query", async () => {
      m.User.find.mockReturnValueOnce(q([]));
      m.AuditLog.find.mockReturnValueOnce(q([]));
      await db.getPaginatedAuditLogs(1, 20, "rice (5kg");
      const query = m.AuditLog.find.mock.calls[0][0];
      expect(query.$or).toContainEqual({ note: { $regex: "rice \\(5kg", $options: "i" } });
      expect(() => new RegExp(query.$or[0].note.$regex)).not.toThrow();
    });
  });

  describe("coupons and bulk prices", () => {
    const coupon = { _id: "c1", code: "K7M3QX", kind: "percent", value: 10 };

    it("claims an open code on first use, applies it to the owner's list and logs both", async () => {
      const order = orderDoc({ status: "draft", coupon: null });
      m.Order.findOne.mockResolvedValueOnce(order);
      m.Coupon.findOneAndUpdate.mockReturnValueOnce(q(coupon));
      await db.setOrderCoupon("pub1", "user1", " k7m3qx ");
      expect(m.Coupon.findOneAndUpdate).toHaveBeenCalledWith(
        { code: "K7M3QX", active: true, usedAt: null, owner: null },
        { $set: { owner: "user1", claimedAt: expect.any(Date) } },
        expect.anything(),
      );
      expect((order as { coupon?: unknown }).coupon).toEqual({ code: "K7M3QX", kind: "percent", value: 10 });
      expect(m.AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: "coupon_claim", targetType: "coupon" }));
      expect(m.AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: "coupon_apply", targetId: "pub1" }));
    });

    it("uses a coupon the user already owns without claiming again", async () => {
      m.Order.findOne.mockResolvedValueOnce(orderDoc({ status: "draft", coupon: null }));
      m.Coupon.findOneAndUpdate.mockReturnValueOnce(q(null));
      m.Coupon.findOne.mockReturnValueOnce(q(coupon));
      await db.setOrderCoupon("pub1", "user1", "K7M3QX");
      expect(m.Coupon.findOne).toHaveBeenCalledWith({ code: "K7M3QX", active: true, usedAt: null, owner: "user1" });
      expect(m.AuditLog.create).not.toHaveBeenCalledWith(expect.objectContaining({ action: "coupon_claim" }));
    });

    it("refuses someone else's, used or unknown coupons", async () => {
      m.Order.findOne.mockResolvedValueOnce(orderDoc({ status: "draft", coupon: null }));
      m.Coupon.findOneAndUpdate.mockReturnValueOnce(q(null));
      m.Coupon.findOne.mockReturnValueOnce(q(null));
      await expect(db.setOrderCoupon("pub1", "user1", "NOPE22")).rejects.toMatchObject({ code: "COUPON_INVALID" });
    });

    it("only lets the owner change the coupon", async () => {
      m.Order.findOne.mockResolvedValueOnce(orderDoc({ status: "draft" }));
      await expect(db.setOrderCoupon("pub1", "someone-else", "K7M3QX")).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("makes a short, easy-to-type code and logs who it was given to", async () => {
      m.User.findOne.mockReturnValueOnce(q({ _id: "507f1f77bcf86cd799439011", username: "ana" }));
      m.Coupon.create.mockImplementationOnce(async (doc: Record<string, unknown>) => ({ _id: "c9", ...doc }));
      const made = await db.createCoupon("staff1", "10%", "507f1f77bcf86cd799439011");
      expect(made.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/);
      expect(made).toMatchObject({ kind: "percent", value: 10, owner: "ana" });
      expect(m.AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: "coupon_create", actorId: "staff1" }));
    });

    it("rolls a new code when one is taken, and rejects a bad discount", async () => {
      m.Coupon.create
        .mockRejectedValueOnce(Object.assign(new Error("dup"), { code: 11000 }))
        .mockImplementationOnce(async (doc: Record<string, unknown>) => ({ _id: "c9", ...doc }));
      const made = await db.createCoupon("staff1", "50", null);
      expect(m.Coupon.create).toHaveBeenCalledTimes(2);
      expect(made).toMatchObject({ kind: "fixed", value: 50, owner: null });
      await expect(db.createCoupon("staff1", "150%", null)).rejects.toMatchObject({ code: "BAD_COUPON_VALUE" });
    });

    it("removes the coupon with an empty code", async () => {
      const order = orderDoc({ status: "draft", coupon: { code: "SUKI10" } });
      m.Order.findOne.mockResolvedValueOnce(order);
      await db.setOrderCoupon("pub1", "user1", "");
      expect((order as { coupon?: unknown }).coupon).toBeNull();
      expect(m.AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: "coupon_remove" }));
    });

    it("checks bulk prices from the client", () => {
      expect(db.cleanPriceTiers([{ qty: "6", price: "9" }, { qty: 3, price: 5 }])).toEqual([{ qty: 3, price: 5 }, { qty: 6, price: 9 }]);
      expect(() => db.cleanPriceTiers([{ qty: 1, price: 5 }])).toThrow();
      expect(() => db.cleanPriceTiers([{ qty: 3, price: 5 }, { qty: 3, price: 4 }])).toThrow();
      expect(() => db.cleanPriceTiers("3 for 5")).toThrow();
    });
  });
});
