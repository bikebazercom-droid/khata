import { Link } from "wouter";
import { SidebarLayout } from "@/components/layout/sidebar";
import { useGetAdminStats, useListAdminUsers, useGetAdminOtpConfig, getGetAdminStatsQueryKey, getListAdminUsersQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, UserCheck, UserPlus, MessageSquare, TrendingUp, Clock } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const fmt = (date: string | null | undefined) => date ? new Date(date).toLocaleString() : "—";

export default function DashboardPage() {
  const { data: stats, isLoading, isError, refetch: refetchStats } = useGetAdminStats({
    query: { queryKey: getGetAdminStatsQueryKey(), refetchInterval: 30_000 },
  });
  const {
    data: users,
    isLoading: usersLoading,
    isError: usersError,
    refetch: refetchUsers,
  } = useListAdminUsers({ page: 1, pageSize: 10 },
    { query: { queryKey: getListAdminUsersQueryKey({ page: 1, pageSize: 10 }), refetchInterval: 30_000 } });
  const {
    data: otp,
    isLoading: otpLoading,
    isError: otpError,
    refetch: refetchOtp,
  } = useGetAdminOtpConfig();
  const trend = stats?.trends.map((row) => ({
    ...row, time: new Date(`${row.date}T00:00:00Z`).getTime(),
  })) ?? [];

  return <SidebarLayout>
    <div className="space-y-7">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
      {isError && (
        <p role="alert" className="text-red-600 flex items-center gap-3">
          Could not load dashboard statistics.
          <button type="button" className="underline" onClick={() => void refetchStats()}>Retry</button>
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {[
          { title: "Registered users", value: stats?.totalUsers, loading: isLoading, icon: Users, color: "bg-blue-50 text-blue-600" },
          { title: "Active now · last 5 min", value: stats?.activeUsers, loading: isLoading, icon: UserCheck, color: "bg-emerald-50 text-emerald-600" },
          { title: "New users today · UTC", value: stats?.newUsersToday, loading: isLoading, icon: UserPlus, color: "bg-violet-50 text-violet-600" },
          { title: "SMS API key", value: otp?.apiKeyConfigured == null
            ? "Unavailable" : otp.apiKeyConfigured ? "Configured" : "Missing",
            loading: otpLoading,
            icon: MessageSquare, color: "bg-amber-50 text-amber-600" },
        ].map(({ title, value, loading, icon: Icon, color }) => (
          <Card key={title} className="border-0 shadow-sm bg-white">
            <CardContent className="p-6 flex justify-between gap-4">
              <div><p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
                <p className="text-3xl font-bold mt-2">{loading ? "…" : value ?? "—"}</p></div>
              <span className={`p-3 h-fit rounded-xl ${color}`}><Icon className="w-5 h-5" /></span>
            </CardContent>
          </Card>
        ))}
      </div>
      {otpError && (
        <p role="alert" className="text-sm text-red-600">
          Could not load OTP gateway status.{" "}
          <button type="button" className="underline" onClick={() => void refetchOtp()}>Retry</button>
        </p>
      )}
      <Card className="border-0 shadow-sm bg-white">
        <CardHeader><CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="w-4 h-4" /> Signups and successful new-session logins · 30 days (UTC)
        </CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">Login events are counted once per new authenticated session, not per token refresh. History begins when event recording was enabled.</p>
          {isLoading ? <p className="py-10 text-sm text-muted-foreground">Loading signup and login trends…</p>
          : isError ? <p className="py-10 text-sm text-muted-foreground">Trends are unavailable until statistics load.</p>
          : trend.length ? <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="time" type="number" scale="time" domain={["dataMin", "dataMax"]}
                  tickFormatter={(v: number) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })} />
                <YAxis allowDecimals={false} domain={[0, "auto"]} />
                <Tooltip labelFormatter={(v) => new Date(Number(v)).toLocaleDateString(undefined, { timeZone: "UTC" })} />
                <Legend />
                <Line name="Signups" dataKey="signups" type="linear" stroke="#61A9BD" strokeWidth={2} dot={false} />
                <Line name="Logins" dataKey="logins" type="linear" stroke="#CED14E" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div> : <p className="text-sm text-muted-foreground">No trends available.</p>}
        </CardContent>
      </Card>
      <Card className="border-0 shadow-sm bg-white">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4" /> Recent registered users</CardTitle>
          <Link href="/users" className="text-sm text-primary hover:underline">View all users →</Link>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground">
              {["Name", "Email", "Phone", "Auth", "Active now", "Last login"].map((h) => <th key={h} className="py-3 px-2">{h}</th>)}
            </tr></thead>
            <tbody>{usersLoading ? (
              <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Loading recent users…</td></tr>
            ) : usersError && !users ? (
              <tr><td colSpan={6} className="py-8 text-center text-red-600">
                Could not load recent users.{" "}
                <button type="button" className="underline" onClick={() => void refetchUsers()}>Retry</button>
              </td></tr>
            ) : users?.items.map((user) => <tr key={user.id} className="border-b last:border-0">
              <td className="py-3 px-2"><Link href={`/users/${user.id}`} className="text-primary hover:underline">{user.name}</Link></td>
              <td className="py-3 px-2">{user.email ?? "—"}</td>
              <td className="py-3 px-2">{user.phone ?? "—"}</td>
              <td className="py-3 px-2">{user.authProvider}</td>
              <td className="py-3 px-2">{user.isOnline ? "Yes" : "No"}</td>
              <td className="py-3 px-2">{fmt(user.lastLogin)}</td>
            </tr>)}</tbody>
          </table>
          {usersError && users && (
            <p role="alert" className="py-3 text-sm text-red-600">Could not refresh recent users.</p>
          )}
          {users && !users.items.length && <p className="py-8 text-center text-muted-foreground">No registered users yet.</p>}
        </CardContent>
      </Card>
    </div>
  </SidebarLayout>;
}