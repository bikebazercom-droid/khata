import { useAuthGuard } from "@/lib/auth";
import { SidebarLayout } from "@/components/layout/sidebar";
import { useGetAdminStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { Users, Building2, ReceiptText, Banknote, ArrowUpRight, Activity } from "lucide-react";

export default function DashboardPage() {
  useAuthGuard();
  const { data: stats, isLoading, isError } = useGetAdminStats();

  if (isLoading) {
    return (
      <SidebarLayout>
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-48 bg-muted rounded"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-muted rounded-xl"></div>
            ))}
          </div>
        </div>
      </SidebarLayout>
    );
  }

  if (isError || !stats) {
    return (
      <SidebarLayout>
        <div className="text-destructive">Failed to load statistics.</div>
      </SidebarLayout>
    );
  }

  const statCards = [
    {
      title: "Total Users",
      value: stats.totalUsers.toLocaleString(),
      icon: Users,
      trend: `+${stats.newUsersThisWeek} this week`,
    },
    {
      title: "Total Businesses",
      value: stats.totalBusinesses.toLocaleString(),
      icon: Building2,
    },
    {
      title: "Total Transactions",
      value: stats.totalTransactions.toLocaleString(),
      icon: ReceiptText,
    },
    {
      title: "Transaction Volume",
      value: formatCurrency(stats.totalTransactionVolume),
      icon: Banknote,
    },
  ];

  return (
    <SidebarLayout>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <h2 className="text-3xl font-bold tracking-tight">Platform Overview</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {statCards.map((stat, i) => {
            const Icon = stat.icon;
            return (
              <Card key={i} className="border-none shadow-sm bg-white overflow-hidden relative group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {stat.title}
                  </CardTitle>
                  <div className="p-2 bg-primary/5 rounded-lg text-primary">
                    <Icon className="w-4 h-4" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stat.value}</div>
                  {stat.trend && (
                    <p className="text-xs text-emerald-600 font-medium mt-1 flex items-center gap-1">
                      <ArrowUpRight className="w-3 h-3" /> {stat.trend}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="w-4 h-4 text-accent" /> Growth Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">New Users Today</span>
                  <span className="font-semibold">{stats.newUsersToday}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">New Users This Week</span>
                  <span className="font-semibold">{stats.newUsersThisWeek}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-muted-foreground">Active Users This Month</span>
                  <span className="font-semibold">{stats.activeUsersThisMonth}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="w-4 h-4 text-primary" /> User Demographics
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">By Source</h4>
                <div className="space-y-3">
                  {Object.entries(stats.usersByLoginSource).map(([key, val]) => (
                    <div key={key} className="flex justify-between items-center">
                      <span className="text-sm capitalize">{key.replace('_', ' ')}</span>
                      <span className="font-medium text-sm bg-muted px-2 py-0.5 rounded">{val as number}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">By Auth</h4>
                <div className="space-y-3">
                  {Object.entries(stats.usersByAuthProvider).map(([key, val]) => (
                    <div key={key} className="flex justify-between items-center">
                      <span className="text-sm capitalize">{key.replace('_', ' ')}</span>
                      <span className="font-medium text-sm bg-muted px-2 py-0.5 rounded">{val as number}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </SidebarLayout>
  );
}
