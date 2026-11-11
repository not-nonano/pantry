import { auth } from "@/auth";
import { PantryLayout } from "@/components/pantry-layout";
import { Badge } from "@/components/ui/badge";
import { getMarketItems, getOrderHistory, getOverviewSessions, getSharedOrder, getUserCoupons } from "@/lib/pantry-db";
import { redirect } from "next/navigation";
import { OrderItemComposer } from "./order-item-composer";
import { EditableQuantityCell } from "./editable-quantity-cell";
import { DeleteItemButton } from "./delete-item-button";
import { UndoActionButton } from "./undo-action-button";
import { ArchiveOrderDialog } from "./archive-order-dialog";
import { ActivityLogMobileModal } from "./activity-log-modal";
import { ReceiptViewer } from "./receipt-viewer";
import { CouponField } from "./coupon-field";
import { cn, formatMoney } from "@/lib/utils";

type SessionPageProps = {
  params: Promise<{
    publicId: string;
  }>;
};

export default async function SessionPage({ params }: Readonly<SessionPageProps>) {
  const session = await auth();

  // Orders are private: signing in is required to open one
  if (!session) {
    redirect("/login");
  }

  const { publicId } = await params;
  const userId = (session.user as Record<string, unknown>)?.id as string | undefined;
  const userRole = (session.user as Record<string, unknown>)?.role as string | undefined;

  let order;
  let historyItems;
  let sessions;
  let marketItems;
  let myCoupons;
  try {
    [order, historyItems, sessions, marketItems, myCoupons] = await Promise.all([
      getSharedOrder(publicId, userId, userRole),
      getOrderHistory(publicId),
      getOverviewSessions(userId),
      getMarketItems(),
      userId ? getUserCoupons(userId) : [],
    ]);
  } catch (error) {
    if (error instanceof Error && (error.message === "ORDER_FORBIDDEN" || error.message === "ORDER_NOT_FOUND")) {
       redirect("/unauthorized");
    }
    throw error;
  }

  const isCreator = order.isAuthor === true;
  const isArchived = order.status === "archived";

  let accessLabel = "Read only";
  if (isCreator) {
    accessLabel = isArchived ? "View only" : "";
  } else if (userRole === "cashier" || userRole === "admin") {
    accessLabel = "Staff view";
  }

  const canEdit = isCreator && !isArchived;

  return (
    <PantryLayout active="overview" sessions={sessions} marketItems={marketItems} userRole={userRole} user={session.user as any}
      mobileAction={<ActivityLogMobileModal historyItems={historyItems} isCreator={isCreator} isAdmin={userRole === "admin"} publicId={publicId} />}
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        {/* The whole order is one receipt */}
        <section aria-label="Order" className="receipt @container min-w-0 px-5 pb-6 pt-6 sm:px-7">
          <header className="flex flex-col items-center gap-1.5 pb-4 text-center">
            <h1 className="break-words text-lg font-bold uppercase tracking-wide">{order.title}</h1>
            <p className="text-xs text-muted-foreground">
              Created {order.createdAtLabel}, {order.items.length} {order.items.length === 1 ? "item" : "items"}
              {isArchived && order.archivedAtLabel && `, paid ${order.archivedAtLabel}`}
            </p>
            {(isArchived || order.paymentMethod === "cash") && (
              <div className="mt-1 flex gap-2">
                {isArchived && <span className="stamp">Paid &amp; locked</span>}
                {order.paymentMethod === "cash" && <span className="stamp text-success">Cash</span>}
              </div>
            )}
          </header>

          {canEdit && (
            // No overflow-hidden here: it would clip the suggestion dropdown.
            <div className="receipt-rule relative z-10 py-4">
              <table className="w-full"><tbody>
                <OrderItemComposer publicId={publicId} marketItems={marketItems} />
              </tbody></table>
            </div>
          )}

          {order.items.length === 0 ? (
            <p className="receipt-rule py-10 text-center text-sm text-muted-foreground">
              {canEdit ? "Nothing on the list yet. Add your first item above." : "No items on this list yet."}
            </p>
          ) : (
            <ul className="receipt-rule">
              {order.items.map((entry, index) => (
                // One aligned row per item on wide receipts; name + total over price + controls on narrow ones.
                // Visual order differs from DOM order on narrow receipts only, so screen readers always get name, price, quantity, total.
                <li
                  key={entry.id ?? `${entry.itemName}-${index}`}
                  className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b border-border px-2 py-3 last:border-b-0 even:bg-muted @xl:grid-cols-[minmax(0,1fr)_7rem_auto_6rem]"
                >
                  <span className={cn("order-1 min-w-0 break-words text-[15px] font-semibold @xl:order-none", isArchived && "text-muted-foreground")}>{entry.itemName}</span>
                  <span className="order-3 text-[13px] text-muted-foreground @xl:order-none">
                    {/* When editable, the stepper shows the quantity, so the line only needs the unit price */}
                    {canEdit
                      ? (entry.unitPrice === null ? "---- each" : `${formatMoney(entry.unitPrice)} each`)
                      : `${entry.quantityLabel} @ ${entry.unitPrice === null ? "----" : formatMoney(entry.unitPrice)}`}
                    {entry.bulkLabel && <span className="block text-success">{entry.bulkLabel}</span>}
                  </span>
                  <span className="order-4 flex items-center justify-end gap-1 @xl:order-none">
                    {canEdit && (
                      <>
                        <EditableQuantityCell publicId={publicId} itemIndex={index} itemName={entry.itemName} quantityLabel={entry.quantityLabel} isCreator={canEdit} variant="inline" />
                        <DeleteItemButton publicId={publicId} itemIndex={index} itemName={entry.itemName} />
                      </>
                    )}
                  </span>
                  <span className="order-2 text-right text-[15px] font-semibold tabular-nums @xl:order-none">
                    {entry.unitPrice !== null && formatMoney(entry.lineTotal)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {order.receiptUrl && (
            <div className="receipt-rule mt-5 flex items-center gap-4 pt-4">
              <ReceiptViewer src={order.receiptUrl} />
            </div>
          )}
        </section>

        {/* Beside the receipt, on the counter: total, pay, access and activity. Above the receipt on phones. */}
        <aside className="order-first min-w-0 space-y-6 lg:order-none lg:sticky lg:top-8">
          <div className="receipt px-5 py-4">
            {order.discount > 0 && (
              <dl className="mb-2 space-y-1 text-sm tabular-nums">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd>₱{formatMoney(order.subtotal)}</dd>
                </div>
                <div className="flex justify-between gap-4 text-success">
                  <dt>
                    Coupon {order.coupon?.code}
                    {order.coupon?.kind === "percent" && ` (${order.coupon.value}% off)`}
                  </dt>
                  <dd>−₱{formatMoney(order.discount)}</dd>
                </div>
              </dl>
            )}
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-[15px] font-bold uppercase">Total</span>
              <span className="text-3xl font-bold" aria-live="polite">₱{formatMoney(order.total)}</span>
            </div>
            {canEdit && (
              <div className="receipt-rule mt-4 pt-4">
                <CouponField publicId={publicId} appliedCode={order.coupon?.code ?? null} myCoupons={myCoupons.filter((c) => c.code !== order.coupon?.code)} />
              </div>
            )}
            {canEdit && (
              <div className="mt-4">
                <ArchiveOrderDialog publicId={publicId} orderTitle={order.title} />
              </div>
            )}
          </div>

          {accessLabel && <Badge variant={isCreator ? "default" : "outline"}>{accessLabel}</Badge>}

          {/* Activity log (desktop; phones use ActivityLogMobileModal) */}
          <div className="hidden lg:block">
            <h2 className="font-display text-lg">Activity</h2>
            <ol className="mt-3 max-h-[calc(100dvh-14rem)] space-y-3 overflow-y-auto pr-2 font-mono text-[13px] custom-scrollbar">
              {historyItems.map((entry) => (
                <li key={entry.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3">
                  <span className="text-muted-foreground">{entry.date}</span>
                  <span className="min-w-0">
                    <span className="font-semibold">{entry.action}</span> {entry.item}, {entry.quantity}
                    {(entry.isAdminRemove ? userRole === "admin" : isCreator) && entry.rawAction === "item_remove" && (
                      <span className="block"><UndoActionButton publicId={publicId} auditLogId={entry.id} /></span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            {historyItems.length === 0 && (
              <p className="mt-3 text-sm text-muted-foreground">Changes to this list show up here.</p>
            )}
          </div>
        </aside>
      </div>
    </PantryLayout>
  );
}
