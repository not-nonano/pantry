export type WorkspaceSession = {
  id?: string;
  publicId?: string;
  title: string;
  preview: string;
  items: string;
  updated: string;
  active: boolean;
  status?: string;
};

export type MarketItem = {
  id?: string;
  name: string;
  price: string;
  status: "Active" | "Draft" | "Archived";
  note: string;
  aliases?: string[];
};

export type SessionLineItem = {
  id?: string;
  itemName: string;
  quantityLabel: string;
  unitPrice: number | null;
  lineTotal: number;
  /** "3 for ₱5.00", empty when the product has no bulk prices */
  bulkLabel?: string;
  status: "draft" | "priced";
};

export type OrderHistoryEntry = {
  id: string;
  date: string;
  item: string;
  quantity: string;
  action: string;
  rawAction?: string;
  isAdminRemove?: boolean;
};

export type SharedOrderView = {
  publicId: string;
  title: string;
  createdAtLabel: string;
  updatedAtLabel: string;
  archivedAtLabel?: string | null;
  items: SessionLineItem[];
  subtotal: number;
  discount: number;
  coupon?: { code: string; kind: "percent" | "fixed"; value: number } | null;
  total: number;
  receiptUrl?: string | null;
  paymentMethod?: "cash" | "receipt" | null;
  status: "draft" | "archived";
  isAuthor?: boolean;
};

export type AddOrderItemRequest = {
  publicId?: string;
  itemIndex?: number;
  itemName: string;
  quantityLabel: string;
};

export type AddOrderItemResponse = {
  item: {
    id: string;
    itemName: string;
    quantityLabel: string;
    unitPrice: number | null;
    lineTotal: number;
    status: "draft" | "priced";
  };
};
