import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  Building2,
  ReceiptText,
  Settings,
  LogOut,
  Menu,
} from "lucide-react";
import { clearAdminAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/users", label: "Users", icon: Users },
  { href: "/businesses", label: "Businesses", icon: Building2 },
  { href: "/transactions", label: "Transactions", icon: ReceiptText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const handleLogout = () => {
    clearAdminAuth();
    setLocation("/");
  };

  const navContent = (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground w-64 border-r border-sidebar-border shadow-xl">
      <div className="p-6">
        <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          <span className="bg-sidebar-primary text-sidebar-primary-foreground p-1.5 rounded-md">
            BK
          </span>
          BanglaKhata
        </h1>
        <p className="text-xs text-sidebar-foreground/60 mt-1 uppercase tracking-widest font-mono">
          Operations Console
        </p>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        {links.map((link) => {
          const isActive = location.startsWith(link.href);
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                  : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
              }`}
              onClick={() => setIsMobileOpen(false)}
            >
              <Icon className={`w-4 h-4 ${isActive ? "text-sidebar-primary" : ""}`} />
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row font-sans">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-sidebar text-sidebar-foreground border-b border-sidebar-border">
        <div className="font-bold flex items-center gap-2">
           <span className="bg-sidebar-primary text-sidebar-primary-foreground p-1 rounded-sm text-xs">
            BK
          </span>
          Admin
        </div>
        <Button variant="ghost" size="icon" onClick={() => setIsMobileOpen(!isMobileOpen)}>
          <Menu className="w-5 h-5 text-white" />
        </Button>
      </div>

      {/* Sidebar Desktop */}
      <aside className="hidden md:block sticky top-0 h-screen">
        {navContent}
      </aside>

      {/* Sidebar Mobile */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-black/50" onClick={() => setIsMobileOpen(false)} />
          <aside className="relative w-64 max-w-[80%] bg-sidebar h-full">
            {navContent}
          </aside>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 overflow-auto p-4 md:p-8">
          <div className="max-w-7xl mx-auto w-full">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
