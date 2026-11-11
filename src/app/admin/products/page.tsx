import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getOverviewSessions, getMarketItems } from "@/lib/pantry-db";
import { PantryLayout } from "@/components/pantry-layout";
import { ProductManager } from "./ProductManager";
import { connectMongo } from "@/lib/db/mongodb";
import { Order, Product as ProductModel } from "@/models";

export default async function AdminProductsPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const role = (session.user as Record<string, unknown>).role as string;
  if (role !== "admin" && role !== "cashier") {
    redirect("/unauthorized");
  }

  await connectMongo();
  const [sessions, marketItems, rawProducts, openListCounts] = await Promise.all([
    getOverviewSessions((session.user as Record<string, unknown>).id as string | undefined),
    getMarketItems(),
    ProductModel.find({ active: true }).lean(),
    // How many open lists each product is on, so unpriced ones people are waiting on can go first
    Order.aggregate<{ _id: unknown; count: number }>([
      { $match: { status: { $ne: "archived" } } },
      { $unwind: "$items" },
      { $group: { _id: "$items.productId", lists: { $addToSet: "$_id" } } },
      { $project: { count: { $size: "$lists" } } },
    ]),
  ]);
  const listCountById = new Map(openListCounts.map((row) => [String(row._id), row.count]));

  const products = rawProducts.map((p: Record<string, unknown>) => ({
    id: String(p._id),
    name: p.name as string,
    price: p.price as number | null,
    priceTiers: ((p.priceTiers as { qty: number; price: number }[] | undefined) ?? []).map((t) => ({ qty: t.qty, price: t.price })),
    aliases: p.aliases ? (p.aliases as Record<string, unknown>[]).map((a: Record<string, unknown>) => a.value as string) : [],
    openLists: listCountById.get(String(p._id)) ?? 0,
  }));

  return (
    <PantryLayout active="overview" sessions={sessions} marketItems={marketItems} userRole={(session.user as Record<string, unknown>).role as string | undefined} user={session.user as any}>
      <ProductManager products={products} />
    </PantryLayout>
  );
}
