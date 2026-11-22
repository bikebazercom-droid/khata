import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { SidebarLayout } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/auth";

type LoginAttempt = {
  id: string; identifier: string; authMethod: string; stage: string; errorCode: string;
  ip: string | null; device: string; occurredAt: string;
};

export default function SignInActivityPage() {
  const [attempts, setAttempts] = useState<LoginAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const attemptsResponse = await adminFetch("/api/admin/login-attempts");
      if (!attemptsResponse.ok) throw new Error("Could not load sign-in activity.");
      const attemptsData = await attemptsResponse.json() as { items: LoginAttempt[] };
      setAttempts(attemptsData.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load sign-in activity.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return <SidebarLayout><div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Sign-in activity</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review recent failed sign-in steps. New users do not need admin approval.</p></div>
      <Link href="/users" className="text-sm font-medium text-primary hover:underline">View users and active sessions</Link>
    </header>
    {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold">Public sign-in is enabled</h2>
      <p className="mt-1 text-sm text-muted-foreground">Anyone with a valid Bangladeshi mobile number can sign in after OTP verification. Verified Google accounts can also sign in without approval. New owners receive their own private, empty ledger; existing staff permissions still apply.</p>
    </section>

    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold">Failed sign-in activity</h2><p className="text-sm text-muted-foreground">Latest 100 events; records are retained for 90 days. OTPs and tokens are never stored.</p></div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>Refresh</Button>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead><tr className="border-b text-muted-foreground">{["Time", "Identity", "Method", "Step", "Error", "IP", "Device"].map((title) => <th key={title} className="p-2">{title}</th>)}</tr></thead>
          <tbody>{attempts.map((item) => <tr className="border-b" key={item.id}>
            <td className="p-2 whitespace-nowrap">{new Date(item.occurredAt).toLocaleString()}</td>
            <td className="p-2 font-mono">{item.identifier}</td><td className="p-2">{item.authMethod}</td>
            <td className="p-2">{item.stage}</td><td className="p-2">{item.errorCode}</td>
            <td className="p-2 font-mono">{item.ip ?? "Unavailable"}</td><td className="p-2 max-w-xs break-words">{item.device}</td>
          </tr>)}
          {!loading && attempts.length === 0 && <tr><td className="p-5 text-center text-muted-foreground" colSpan={7}>No failed sign-in attempts recorded.</td></tr>}</tbody>
        </table>
      </div>
      {loading && <p role="status" className="py-4 text-center text-sm text-muted-foreground">Loading sign-in activity…</p>}
    </section>
  </div></SidebarLayout>;
}
