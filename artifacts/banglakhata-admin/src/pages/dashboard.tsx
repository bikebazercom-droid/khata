import { useAuthGuard } from "@/lib/auth";
import { SidebarLayout } from "@/components/layout/sidebar";
import { useGetAdminStats, useListAdminUsers, useGetAdminOtpConfig } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Smartphone, Mail, MessageSquare, TrendingUp, Download, Clock } from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("bn-BD", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function sourceLabel(src: string) {
  const map: Record<string, string> = {
    play_store: "Play Store",
    app_store: "App Store",
    web: "Web",
  };
  return map[src] ?? src;
}

function authLabel(auth: string) {
  const map: Record<string, string> = {
    gmail: "Gmail",
    phone_otp: "Phone OTP",
  };
  return map[auth] ?? auth;
}

// ── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  title, value, icon: Icon, accent,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  accent?: string;
}) {
  return (
    <Card className="border-0 shadow-sm bg-white overflow-hidden">
      <CardContent className="p-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">{title}</p>
          <p className="text-3xl font-bold text-foreground">{value}</p>
        </div>
        <div className={`p-3 rounded-xl ${accent ?? "bg-primary/10 text-primary"}`}>
          <Icon className="w-5 h-5" />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Chart placeholder ─────────────────────────────────────────────────────────

function ChartPlaceholder({ title, icon: Icon }: { title: string; icon: React.ElementType }) {
  return (
    <Card className="border-0 shadow-sm bg-white">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Icon className="w-4 h-4 text-accent" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-52 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-muted text-muted-foreground">
          <Icon className="w-8 h-8 opacity-20" />
          <p className="text-xs">ডেটা সংগ্রহ শুরু হলে চার্ট দেখাবে</p>
          <p className="text-[10px] opacity-60">No data yet — chart will populate as users register</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  useAuthGuard();

  const { data: stats, isLoading: statsLoading } = useGetAdminStats();
  const { data: usersPage, isLoading: usersLoading } = useListAdminUsers(
    { page: 1, pageSize: 50 },
    { query: { refetchInterval: 30_000 } },
  );
  const { data: otpCfg, isLoading: otpLoading } = useGetAdminOtpConfig();

  const totalCustomers = stats?.totalUsers ?? 0;
  const mobileLogins   = (stats?.usersByLoginSource?.["play_store"] ?? 0) +
                         (stats?.usersByLoginSource?.["app_store"] ?? 0);
  const gmailLogins    = stats?.usersByAuthProvider?.["gmail"] ?? 0;
  const otpBalance     = otpCfg?.remainingBalance ?? 0;

  const isLoading = statsLoading || usersLoading || otpLoading;

  return (
    <SidebarLayout>
      <div className="space-y-7">

        {/* ── Status badge ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <span className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold px-4 py-2 rounded-full shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            সক্রিয় ডাটাবেজ: ক্লাউড কানেক্টেড 🟢
          </span>
        </div>

        {/* ── 4 KPI cards ──────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 bg-muted animate-pulse rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <KpiCard
              title="Total Customers"
              value={totalCustomers.toLocaleString()}
              icon={Users}
              accent="bg-blue-50 text-blue-600"
            />
            <KpiCard
              title="Mobile Logins"
              value={mobileLogins.toLocaleString()}
              icon={Smartphone}
              accent="bg-violet-50 text-violet-600"
            />
            <KpiCard
              title="Gmail Logins"
              value={gmailLogins.toLocaleString()}
              icon={Mail}
              accent="bg-rose-50 text-rose-600"
            />
            <KpiCard
              title="Remaining OTP Balance"
              value={otpBalance === 0 ? "—" : otpBalance.toLocaleString()}
              icon={MessageSquare}
              accent="bg-amber-50 text-amber-600"
            />
          </div>
        )}

        {/* ── 2 chart placeholders ──────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <ChartPlaceholder title="Monthly Traffic Trend" icon={TrendingUp} />
          <ChartPlaceholder title="Play Store vs App Store Downloads" icon={Download} />
        </div>

        {/* ── Customer Live Audit Table ─────────────────────────────────── */}
        <Card className="border-0 shadow-sm bg-white">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Customer Live Audit
            </CardTitle>
            {usersPage && (
              <span className="text-xs text-muted-foreground">
                {usersPage.total} total record{usersPage.total !== 1 ? "s" : ""}
              </span>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto rounded-b-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    {["User ID", "Name", "Download Source", "Auth Method", "Device", "Last Login Time"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {usersLoading ? (
                    [...Array(5)].map((_, i) => (
                      <tr key={i} className="border-b">
                        {[...Array(6)].map((_, j) => (
                          <td key={j} className="px-4 py-3">
                            <div className="h-3 bg-muted animate-pulse rounded w-24" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : !usersPage?.items?.length ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-16 text-center text-muted-foreground text-xs">
                        <div className="flex flex-col items-center gap-2">
                          <Users className="w-8 h-8 opacity-20" />
                          <span>কোনো নিবন্ধিত ব্যবহারকারী নেই</span>
                          <span className="opacity-60">Audit table will populate as users register</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    usersPage.items.map((u, i) => (
                      <tr
                        key={u.id}
                        className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                      >
                        <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                          {u.id.split("-")[0].toUpperCase()}
                        </td>
                        <td className="px-4 py-3 font-medium whitespace-nowrap">{u.name}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-violet-50 text-violet-700">
                            {sourceLabel(u.loginSource)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            u.authProvider === "gmail"
                              ? "bg-rose-50 text-rose-700"
                              : "bg-blue-50 text-blue-700"
                          }`}>
                            {authLabel(u.authProvider)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {u.deviceMeta || "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(u.lastLogin)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

      </div>
    </SidebarLayout>
  );
}
