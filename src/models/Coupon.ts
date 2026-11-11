import { Schema, model, models, type InferSchemaType } from "mongoose";

// A one-time discount for one person. Staff (admin or cashier) give it to someone directly,
// or leave it open so the first person to claim the code (typed or scanned) gets it.
const couponSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, unique: true, index: true, maxlength: 32 },
    kind: { type: String, enum: ["percent", "fixed"], required: true },
    value: { type: Number, required: true, min: 0.01 },
    // Who can use it; null until someone claims it
    owner: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    claimedAt: { type: Date, default: null },
    // Set when the list it was on is paid; a used coupon can't be used again
    usedAt: { type: Date, default: null },
    usedOn: { type: String, default: null },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

export type CouponDocument = InferSchemaType<typeof couponSchema>;

// Hot reload keeps the old compiled model, so drop it in dev to pick up schema changes (same as AuditLog)
if (process.env.NODE_ENV === "development" && models.Coupon) {
  delete models.Coupon;
}

export const Coupon = models.Coupon || model("Coupon", couponSchema);
