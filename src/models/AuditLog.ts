import { Schema, model, models, type InferSchemaType } from "mongoose";

const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    targetType: {
      type: String,
      enum: ["user", "order", "product", "category", "coupon"],
      required: true,
      index: true,
    },
    targetId: { type: String, required: true, index: true },
    action: {
      type: String,
      enum: [
        "create", "update", "delete", "finalize", "pay", "share", "price_adjust", "alias_add", 
        "item_add", "quantity_update", "item_remove", "item_undo_remove", "order_archive",
        "user_create", "user_update", "user_delete", "user_reset_password",
        "product_create", "product_update", "product_delete", "product_merge",
        "category_upsert",
        "coupon_create", "coupon_update", "coupon_claim", "coupon_apply", "coupon_remove", "coupon_redeem"
      ],
      required: true,
      index: true,
    },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    note: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

export type AuditLogDocument = InferSchemaType<typeof auditLogSchema>;

if (process.env.NODE_ENV === "development" && models.AuditLog) {
  delete models.AuditLog;
}

export const AuditLog = models.AuditLog || model("AuditLog", auditLogSchema);
