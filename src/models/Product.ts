import { Schema, model, models, type InferSchemaType, Types } from "mongoose";

const productAliasSchema = new Schema(
  {
    value: { type: String, required: true, trim: true, lowercase: true },
    source: { type: String, trim: true, default: "manual" },
  },
  { _id: false },
);

const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    aliases: { type: [productAliasSchema], default: [] },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", default: null, index: true },
    price: { type: Number, default: null, min: 0 },
    // Bulk prices: { qty: 3, price: 5 } means 3 for ₱5
    priceTiers: {
      type: [new Schema({ qty: { type: Number, required: true, min: 2 }, price: { type: Number, required: true, min: 0 } }, { _id: false })],
      default: [],
    },
    unit: { type: String, trim: true, default: "" },
    active: { type: Boolean, default: true, index: true },
    notes: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

export type ProductDocument = InferSchemaType<typeof productSchema> & { categoryId: Types.ObjectId | null };

// Hot reload keeps the old compiled model, so drop it in dev to pick up schema changes (same as AuditLog)
if (process.env.NODE_ENV === "development" && models.Product) {
  delete models.Product;
}

export const Product = models.Product || model("Product", productSchema);
