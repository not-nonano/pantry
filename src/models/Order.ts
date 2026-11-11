import { Schema, model, models, type InferSchemaType, Types } from "mongoose";

const orderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    itemName: { type: String, trim: true, default: null },
    normalizedItemName: { type: String, trim: true, lowercase: true, default: null, index: true },
    quantity: { type: Number, required: true, min: 1 },
    quantityLabel: { type: String, trim: true, default: "" },
    unit: { type: String, trim: true, default: "" },
    unitPrice: { type: Number, default: null, min: 0 },
    lineTotal: { type: Number, default: 0, min: 0 },
    // Bulk prices that applied when paid ("3 for ₱5.00"), so a paid line still explains its total
    bulkLabel: { type: String, default: "" },
    status: {
      type: String,
      enum: ["draft", "priced"],
      default: "draft",
      index: true,
    },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, trim: true, default: "" },
    items: { type: [orderItemSchema], default: [] },
    status: {
      type: String,
      enum: ["draft", "archived"],
      default: "draft",
      index: true,
    },
    // Copy of the coupon at the time it was applied; staff can't change a coupon's value later
    coupon: {
      type: new Schema({ code: String, kind: { type: String, enum: ["percent", "fixed"] }, value: Number }, { _id: false }),
      default: null,
    },
    subtotal: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },
    archivedAt: { type: Date, default: null },
    receiptUrl: { type: String, default: null },
    paymentMethod: { type: String, enum: ["cash", "receipt", null], default: null },
  },
  { timestamps: true },
);

// One open list per user, enforced by the database so a double submit can't make two
orderSchema.index(
  { authorId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "draft" }, name: "one_open_order_per_user" },
);

export type OrderDocument = InferSchemaType<typeof orderSchema> & {
  authorId: Types.ObjectId;
};

if (process.env.NODE_ENV === "development" && models.Order) {
  delete models.Order;
}

export const Order = models.Order || model("Order", orderSchema);
