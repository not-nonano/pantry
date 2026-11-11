"use client";

import type { ReactNode } from "react";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { MessageSquarePlus, ShoppingBasket } from "lucide-react";
import { usePathname } from "next/navigation";

import type { MarketItem, WorkspaceSession } from "../lib/pantry-types";

import { Button } from "./ui/button";
import { cn } from "../lib/utils";

// Sub-components
import { ShellBrand } from "./sidebar/brand";
import { SessionList } from "./sidebar/nav-list";
import { AccountMenu, type ThemeMode } from "./sidebar/account-menu";
import { MarketModal } from "./market-modal";
import { QrModal } from "./qr-modal";
import { RequestItemModal } from "./request-item-modal";

type UserProfile = {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: string;
};

type PantryLayoutProps = {
  active: "overview" | "market" | "users";
  children: ReactNode;
  sessions?: ReadonlyArray<WorkspaceSession>;
  marketItems?: ReadonlyArray<MarketItem>;
  showSidebar?: boolean;
  userRole?: string;
  user?: UserProfile;
  /** Page-specific button shown on the right of the phone top bar */
  mobileAction?: ReactNode;
};

/**
 * PantryLayout
 * 
 * The primary application shell that provides the sidebar navigation, 
 * theme management, and responsive layout grid.
 */

export function PantryLayout({
  active,
  children,
  sessions = [],
  marketItems = [],
  showSidebar = true,
  userRole,
  user,
  mobileAction,
}: Readonly<PantryLayoutProps>) {
  const [collapsed, setCollapsed] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();

  const themeMode = (theme as ThemeMode) || "system";
  const setThemeMode = (mode: ThemeMode) => setTheme(mode);

  const sidebarTitle = active === "market" ? "Market" : "Your orders";

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Collapsing is a desktop feature; the phone drawer always opens full width.
  const isCollapsed = collapsed && !mobileMenuOpen;

  // Close mobile menu when screen resizes to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <main className="relative min-h-screen bg-background text-foreground">
      {showSidebar && (
        <div className="sticky top-0 z-40 flex items-center gap-2 bg-band px-4 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] text-band-foreground lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open menu"
            className="-ml-2 text-band-foreground hover:bg-band-foreground/15"
            onClick={() => setMobileMenuOpen(true)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
          </Button>
          <Link href="/" className="font-display text-xl">Pantry</Link>
          {mobileAction && <div className="ml-auto">{mobileAction}</div>}
        </div>
      )}

      <div
        className={cn(
          "relative grid min-h-screen w-full transition-[grid-template-columns] duration-300",
          showSidebar ? (collapsed ? "lg:grid-cols-[64px_minmax(0,1fr)]" : "lg:grid-cols-[220px_minmax(0,1fr)]") : "grid-cols-1"
        )}
      >
        {/* Mobile Overlay */}
        {showSidebar && (
          <div 
            className={cn(
              "fixed inset-0 z-40 bg-foreground/40 lg:hidden transition-opacity duration-200",
              mobileMenuOpen ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar Section */}
        {showSidebar && (
          <aside
            className={cn(
              "fixed inset-y-0 left-0 z-50 flex h-dvh flex-col overflow-x-hidden border-r border-border bg-sidebar py-5 transition-[transform,width] duration-300 motion-reduce:transition-none lg:sticky lg:top-0 lg:translate-x-0",
              mobileMenuOpen ? "translate-x-0" : "-translate-x-full",
              isCollapsed ? "w-[64px] px-2" : "w-[280px] sm:w-[320px] lg:w-[220px] px-4",
            )}
          >
            <ShellBrand
              collapsed={isCollapsed}
              mobile={mobileMenuOpen}
              onToggle={() => {
                setAccountOpen(false);
                if (mobileMenuOpen) setMobileMenuOpen(false);
                else setCollapsed((value) => !value);
              }}
            />

            {/* Navigation Area */}
            <div className={cn("mt-5 flex-1 overflow-y-auto no-scrollbar pr-1", isCollapsed && "pr-0")}>
              {(userRole === "admin" || userRole === "cashier") ? (
                <div className={cn(
                  "overflow-hidden transition-[width,opacity] duration-300 motion-reduce:transition-none",
                  isCollapsed ? "w-0 opacity-0" : "w-[188px] opacity-100"
                )}>
                  <div className="w-[188px] space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="px-2 text-xs font-semibold text-muted-foreground">Manage</p>
                    </div>
                    <div className="space-y-1">
                      <Link
                        href="/"
                        className={cn(
                          "block w-full rounded-control px-2 py-2 text-left transition-colors",
                          pathname === "/" 
                            ? "bg-card font-bold text-card-foreground" 
                            : "font-medium text-foreground/80 hover:bg-card/60 hover:text-foreground"
                        )}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <span className="truncate text-sm">Home</span>
                      </Link>
                      <Link
                        href="/admin/orders"
                        className={cn(
                          "block w-full rounded-control px-2 py-2 text-left transition-colors",
                          pathname === "/admin/orders" 
                            ? "bg-card font-bold text-card-foreground" 
                            : "font-medium text-foreground/80 hover:bg-card/60 hover:text-foreground"
                        )}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <span className="truncate text-sm">Orders</span>
                      </Link>
                      <Link
                        href="/admin/products"
                        className={cn(
                          "block w-full rounded-control px-2 py-2 text-left transition-colors",
                          pathname === "/admin/products" 
                            ? "bg-card font-bold text-card-foreground" 
                            : "font-medium text-foreground/80 hover:bg-card/60 hover:text-foreground"
                        )}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <span className="truncate text-sm">Products</span>
                      </Link>
                      <Link
                        href="/admin/requests"
                        className={cn(
                          "block w-full rounded-control px-2 py-2 text-left transition-colors",
                          pathname === "/admin/requests"
                            ? "bg-card font-bold text-card-foreground"
                            : "font-medium text-foreground/80 hover:bg-card/60 hover:text-foreground"
                        )}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <span className="truncate text-sm">Requests</span>
                      </Link>
                      <Link
                        href="/admin/coupons"
                        className={cn(
                          "block w-full rounded-control px-2 py-2 text-left transition-colors",
                          pathname === "/admin/coupons"
                            ? "bg-card font-bold text-card-foreground"
                            : "font-medium text-foreground/80 hover:bg-card/60 hover:text-foreground"
                        )}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <span className="truncate text-sm">Coupons</span>
                      </Link>
                      {userRole === "admin" && (
                        <>
                          <Link
                            href="/admin/users"
                            className={cn(
                              "block w-full rounded-control px-2 py-2 text-left transition-colors",
                              pathname === "/admin/users" 
                                ? "bg-card font-bold text-card-foreground" 
                                : "font-medium text-foreground/80 hover:bg-card/60 hover:text-foreground"
                            )}
                            onClick={() => setMobileMenuOpen(false)}
                          >
                            <span className="truncate text-sm">Users</span>
                          </Link>
                          <Link
                            href="/admin/feedback"
                            className={cn(
                              "block w-full rounded-control px-2 py-2 text-left transition-colors",
                              pathname === "/admin/feedback"
                                ? "bg-card font-bold text-card-foreground"
                                : "font-medium text-foreground/80 hover:bg-card/60 hover:text-foreground"
                            )}
                            onClick={() => setMobileMenuOpen(false)}
                          >
                            <span className="truncate text-sm">Feedback</span>
                          </Link>
                          <Link
                            href="/admin/audit-logs"
                            className={cn(
                              "block w-full rounded-control px-2 py-2 text-left transition-colors",
                              pathname === "/admin/audit-logs" 
                                ? "bg-card font-bold text-card-foreground" 
                                : "font-medium text-foreground/80 hover:bg-card/60 hover:text-foreground"
                            )}
                            onClick={() => setMobileMenuOpen(false)}
                          >
                            <span className="truncate text-sm">Audit log</span>
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div onClick={() => setMobileMenuOpen(false)}>
                  <div className={cn(
                    "overflow-hidden transition-[width,opacity] duration-300 motion-reduce:transition-none",
                    isCollapsed ? "w-0 opacity-0" : "w-[188px] opacity-100"
                  )}>
                    <div className="flex items-center justify-between mb-3">
                      <p className="px-1 text-xs font-semibold text-muted-foreground">{sidebarTitle}</p>
                    </div>
                  </div>
                  <SessionList collapsed={isCollapsed} sessions={sessions} />
                </div>
              )}
            </div>

            {/* Sidebar Footer Actions */}
            <div className="mt-5 space-y-3 border-t border-border pt-4 shrink-0">
              <Button
                variant="secondary"
                className={cn("w-full", isCollapsed ? "justify-center px-0" : "justify-between px-2")}
                aria-label="Open item requests"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setRequestOpen(true);
                }}
              >
                <MessageSquarePlus aria-hidden="true" className="h-[18px] w-9 shrink-0 text-primary" />
                <div className={cn(
                  "overflow-hidden transition-[width,opacity] duration-300 motion-reduce:transition-none",
                  isCollapsed ? "w-0 opacity-0" : "w-[155px] opacity-100"
                )}>
                  <div className="w-[155px] flex items-center pl-2">
                    <span className="whitespace-nowrap">Item requests</span>
                  </div>
                </div>
              </Button>

              <Button
                variant="secondary"
                className={cn("w-full", isCollapsed ? "justify-center px-0" : "justify-between px-2")}
                aria-label="Open QR code list"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setQrOpen(true);
                }}
              >
                <div aria-hidden="true" className="w-9 shrink-0 flex justify-center text-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="6" height="6" x="3" y="3" rx="1.5" />
                    <rect width="6" height="6" x="15" y="3" rx="1.5" />
                    <rect width="6" height="6" x="3" y="15" rx="1.5" />
                    <path d="M16 16h1v2" />
                    <path d="M20 16h1v5h-4" />
                    <path d="M12 7h1" />
                    <path d="M12 11h2" />
                    <path d="M7 12v1" />
                    <path d="M12 16v2" />
                  </svg>
                </div>
                <div className={cn(
                  "overflow-hidden transition-[width,opacity] duration-300 motion-reduce:transition-none",
                  isCollapsed ? "w-0 opacity-0" : "w-[155px] opacity-100"
                )}>
                  <div className="w-[155px] flex items-center pl-2">
                    <span className="whitespace-nowrap">QR Code</span>
                  </div>
                </div>
              </Button>

              <Button
                variant="secondary"
                className={cn("w-full", isCollapsed ? "justify-center px-0" : "justify-between px-2")}
                aria-label="Open market list"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setMarketOpen(true);
                }}
              >
                <ShoppingBasket aria-hidden="true" className="h-[18px] w-9 shrink-0 text-primary" />
                <div className={cn(
                  "overflow-hidden transition-[width,opacity] duration-300 motion-reduce:transition-none",
                  isCollapsed ? "w-0 opacity-0" : "w-[155px] opacity-100"
                )}>
                  <div className="w-[155px] flex items-center pl-2">
                    <span className="whitespace-nowrap">Market list</span>
                  </div>
                </div>
              </Button>

              <AccountMenu
                collapsed={isCollapsed}
                open={accountOpen}
                themeMode={themeMode}
                onOpenChange={setAccountOpen}
                onThemeChange={setThemeMode}
                userRole={userRole}
                user={user}
              />
            </div>
          </aside>
        )}

        {/* Content Area Section */}
        <section className="flex min-w-0 flex-1">
          <div className="flex min-h-[calc(100dvh-61px)] w-full flex-col px-4 py-5 text-left sm:px-6 lg:min-h-screen lg:px-10 lg:py-8">
            <div className={cn(
              "flex w-full flex-1 flex-col gap-6 text-left",
              pathname.startsWith("/order-list") || pathname.startsWith("/admin/orders")
                ? "max-w-5xl mx-auto" 
                : "max-w-full"
            )}>
              {children}
            </div>
          </div>
        </section>
      </div>

      {/* Overlays */}
      <MarketModal open={marketOpen} onClose={() => setMarketOpen(false)} marketItems={marketItems} />
      <QrModal open={qrOpen} onClose={() => setQrOpen(false)} />
      <RequestItemModal open={requestOpen} onClose={() => setRequestOpen(false)} />
    </main>
  );
}
