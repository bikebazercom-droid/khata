import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { SidebarLayout } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminFetch } from "@/lib/auth";

type ApprovedLogin = {
  id: string; kind: "phone" | "email"; identifier: string; note: string | null; createdAt: string;
};
type LoginAttempt = {
  id: string; identifier: string; authMethod: string; stage: string; errorCode: string;
  ip: string | null; device: string; occurredAt: string;
};

export default function SignInActivityPage() {
  const [approved, setApproved] = useState<ApprovedLogin[]>([]);
  const [attempts, setAttempts] = useState<LoginAttempt[]>([]);
  const [kind, setKind] = useState<"phone" | "email">("phone");
  const [identifier, setIdentifier] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [approvedResponse, attemptsResponse] = await Promise.all([
        adminFetch("/api/admin/preapproved-logins"),
        adminFetch("/api/admin/login-attempts"),
      ]);
      if (!approvedResponse.ok || !attemptsResponse.ok) throw new Error("Could not load sign-in activity.");
      const approvedData = await approvedResponse.json() as { items: ApprovedLogin[] };
      const attemptsData = await attemptsResponse.json() as { items: LoginAttempt[] };
      setApproved(approvedData.items);
      setAttempts(attemptsData.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load sign-in activity.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const addApproved = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await adminFetch("/api/admin/preapproved-logins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, identifier, note: note || undefined }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not add the pre-approved login.");
      setIdentifier(""); setNote(""); setMessage("Identity pre-approved. The user must still complete normal identity verification.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the pre-approved login.");
    } finally {
      setSaving(false);
    }
  };

  const removeApproved = async (id: string) => {
    setError(""); setMessage("");
    try {
      const response = await adminFetch(`/api/admin/preapproved-logins/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Could not remove this identity.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove this identity.");
    }
  };

  return <SidebarLayout><div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Sign-in activity</h1>
        <p className="mt-1 text-sm text-muted-foreground">Pre-approve new accounts and review recent failed sign-in steps.</p></div>
      <Link href="/users" className="text-sm font-medium text-primary hover:underline">View users and active sessions</Link>
    </header>
    {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}

    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold">Pre-approved logins</h2>
      <p className="mt-1 text-sm text-muted-foreground">Allowlisted identities may create an account after completing OTP or verified OAuth. This does not bypass identity verification.</p>
      <form onSubmit={addApproved} className="mt-4 grid gap-3 sm:grid-cols-[130px_1fr_1fr_auto]">
        <label className="sr-only" htmlFor="identity-kind">Identity type</label>
        <select id="identity-kind" className="h-10 rounded-md border bg-white px-3 text-sm" value={kind}
          onChange={(event) => setKind(event.target.value as "phone" | "email")}>
          <option value="phone">Phone</option><option value="email">Email</option>
        </select>
        <Input aria-label={kind === "phone" ? "Phone number" : "Email address"}
          placeholder={kind === "phone" ? "+8801XXXXXXXXX" : "name@example.com"} value={identifier}
          onChange={(event) => setIdentifier(event.target.value)} required />
        <Input aria-label="Optional note" placeholder="Optional note" value={note}
          onChange={(event) => setNote(event.target.value)} maxLength={300} />
        <Button type="submit" disabled={saving}>{saving ? "Adding…" : "Pre-approve"}</Button>
      </form>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[540px] text-left text-sm">
          <thead><tr className="border-b text-muted-foreground"><th className="p-2">Type</th><th className="p-2">Identity</th><th className="p-2">Note</th><th className="p-2">Added</th><th className="p-2"></th></tr></thead>
          <tbody>{approved.map((item) => <tr className="border-b" key={item.id}>
            <td className="p-2 capitalize">{item.kind}</td><td className="p-2 font-mono">{item.identifier}</td>
            <td className="p-2">{item.note ?? "—"}</td><td className="p-2 whitespace-nowrap">{new Date(item.createdAt).toLocaleString()}</td>
            <td className="p-2 text-right"><Button type="button" size="sm" variant="outline" onClick={() => void removeApproved(item.id)}>Remove</Button></td>
          </tr>)}
          {!loading && approved.length === 0 && <tr><td className="p-5 text-center text-muted-foreground" colSpan={5}>No identities pre-approved.</td></tr>}</tbody>
        </table>
      </div>
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
