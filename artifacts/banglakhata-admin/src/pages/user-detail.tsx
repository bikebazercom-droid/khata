import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAdminUser, useUpdateAdminUser, getGetAdminUserQueryKey,
  useBlockIp, useUnblockIp, useListBlockedIps, getListBlockedIpsQueryKey,
} from "@workspace/api-client-react";
import { useAuthGuard } from "@/lib/auth";
import { SidebarLayout } from "@/components/layout/sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function UserDetailPage() {
  useAuthGuard();
  const { id } = useParams<{ id: string }>();
  const { data: user, isLoading, isError } = useGetAdminUser(id, { query: { queryKey: getGetAdminUserQueryKey(id), enabled: !!id, refetchInterval: 30_000 } });
  const { data: blocked } = useListBlockedIps();
  const update = useUpdateAdminUser();
  const block = useBlockIp();
  const unblock = useUnblockIp();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getGetAdminUserQueryKey(id) });
    void qc.invalidateQueries({ queryKey: getListBlockedIpsQueryKey() });
  };
  const changeStatus = () => {
    if (!user) return;
    update.mutate({ userId: id, data: { status: user.status === "active" ? "suspended" : "active" } },
      { onSuccess: refresh, onError: () => setError("Could not update user status.") });
  };
  const toggleIp = (ip: string) => {
    setError("");
    if (blocked?.items.some((item) => item.ip === ip)) {
      unblock.mutate({ ip }, { onSuccess: refresh, onError: () => setError("Unable to unblock IP.") });
    } else {
      if (!window.confirm(`Block network IP ${ip}? This can affect other users on the same shared network.`)) return;
      block.mutate({ data: { ip, reason } }, { onSuccess: () => { setReason(""); refresh(); },
        onError: () => setError("Unable to block IP. Check the address and try again.") });
    }
  };
  const fmt = (date: string | null | undefined) => date ? new Date(date).toLocaleString() : "—";

  return <SidebarLayout><div className="space-y-6">
    <div className="flex items-center gap-4"><Link href="/users" className="text-primary hover:underline">← Users</Link>
      <h1 className="text-2xl font-bold">User details</h1></div>
    {isLoading && <p>Loading user…</p>}
    {isError && <p role="alert" className="text-red-600">Unable to load user.</p>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {user && <>
      <Card className="border-0 shadow-sm bg-white"><CardHeader><CardTitle>Account</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div><span className="text-muted-foreground">Name</span><p className="font-semibold">{user.name}</p></div>
          <div><span className="text-muted-foreground">Email</span><p>{user.email ?? "—"}</p></div>
          <div><span className="text-muted-foreground">Phone</span><p>{user.phone ?? "—"}</p></div>
          <div><span className="text-muted-foreground">Authentication</span><p>{user.authProvider}</p></div>
          <div><span className="text-muted-foreground">Joined</span><p>{fmt(user.createdAt)}</p></div>
          <div><span className="text-muted-foreground">Last successful login</span><p>{fmt(user.lastLogin)}</p></div>
          <div><span className="text-muted-foreground">Foreground activity (last 5 min)</span><p>{user.isOnline ? "Online" : "Offline"}</p></div>
          <div><span className="text-muted-foreground">Status</span><p>{user.status}</p></div>
          <div className="sm:col-span-2"><span className="text-muted-foreground">User ID</span><p className="font-mono break-all">{user.id}</p></div>
          <div className="sm:col-span-2"><Button variant={user.status === "active" ? "destructive" : "default"}
            onClick={changeStatus} disabled={update.isPending}>{user.status === "active" ? "Suspend user" : "Reactivate user"}</Button></div>
        </CardContent></Card>
      <Card className="border-0 shadow-sm bg-white">
        <CardHeader><CardTitle>Successful login history (latest 50 · retained 90 days)</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">IP restrictions affect everyone on a shared IP, including existing sessions and OTP routes—not a permanent device ban. IPs recorded before a verified policy was configured may belong to a shared proxy. Review them before blocking.</p>
          <p role="status" className={`text-sm p-3 rounded mb-4 ${blocked?.policy.configured && blocked.policy.clientIpAvailable ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
            {blocked?.policy.message ?? "Checking client IP policy…"}
            {blocked?.policy.configured && !blocked.policy.clientIpAvailable && " No verifiable client IP on this request; blocking is disabled."}
          </p>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Input className="max-w-sm" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)}
              placeholder="Optional reason for blocking an IP" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-muted-foreground">
                {["Time", "IP", "Device / browser", "Method", "Client", "Network access"].map((h) => <th key={h} className="p-2">{h}</th>)}
              </tr></thead>
              <tbody>{user.loginHistory.map((event) => {
                const isBlocked = blocked?.items.some((item) => item.ip === event.ip);
                return <tr key={event.id} className="border-b">
                  <td className="p-2 whitespace-nowrap">{fmt(event.occurredAt)}</td>
                  <td className="p-2 font-mono">{event.ip ?? "Unavailable (client IP policy not verified)"}</td>
                  <td className="p-2 max-w-xs break-words">{event.device}</td>
                  <td className="p-2">{event.authMethod}</td>
                  <td className="p-2">{event.source}</td>
                  <td className="p-2"><Button size="sm" variant={isBlocked ? "outline" : "destructive"}
                    disabled={!event.ip || !blocked || (!isBlocked && !blocked.policy.clientIpAvailable) || block.isPending || unblock.isPending}
                    onClick={() => { if (event.ip) toggleIp(event.ip); }}>
                    {isBlocked ? "Unblock" : "Block IP"}</Button></td>
                </tr>;
              })}</tbody>
            </table>
            {!user.loginHistory.length && <p className="py-8 text-center text-muted-foreground">No recorded login events yet. Historical logins before audit activation are not available.</p>}
          </div>
        </CardContent>
      </Card>
    </>}
  </div></SidebarLayout>;
}