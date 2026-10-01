import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuthGuard, getAdminToken } from "@/lib/auth";
import { SidebarLayout } from "@/components/layout/sidebar";
import {
  useGetAdminOtpConfig, useUpdateAdminOtpConfig, getGetAdminOtpConfigQueryKey,
  useListBlockedIps, useBlockIp, useUnblockIp, getListBlockedIpsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Save, Download, Monitor, Upload, CheckCircle2, FileUp, AlertCircle, Apple } from "lucide-react";
import { formatDate } from "@/lib/format";

// ── Download-config types & hook ─────────────────────────────────────────────

interface DownloadConfigRow {
  windowsExeUrl:   string;
  updatedAt:       string | null;
}

function useDownloadConfig() {
  const [data, setData]       = useState<DownloadConfigRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/download-configs", {
        headers: { Authorization: `Bearer ${getAdminToken()}` },
      });
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (payload: Omit<DownloadConfigRow, "updatedAt">) => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/download-configs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:  `Bearer ${getAdminToken()}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated: DownloadConfigRow = await res.json();
      setData(updated);
      toast({ title: "সংরক্ষিত হয়েছে ✓", description: "ডাউনলোড লিংক আপডেট হয়েছে।" });
    } catch {
      toast({ variant: "destructive", title: "সংরক্ষণ ব্যর্থ", description: "আবার চেষ্টা করুন।" });
    } finally {
      setSaving(false);
    }
  }, [toast]);

  return { data, loading, saving, save };
}

// ── Binary file info types & hook ─────────────────────────────────────────────

interface BinaryFileInfo { exists: boolean; size: number; mtime: string | null; }
interface BinaryInfo     { exe: BinaryFileInfo; mac: BinaryFileInfo; }

function fmtBytes(b: number) {
  if (b < 1024)            return `${b} B`;
  if (b < 1024 * 1024)     return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/** Sizes ≤ 1 KB are the auto-generated startup placeholders. */
function isPlaceholder(info: BinaryFileInfo) { return info.size <= 1024; }

function useBinaryInfo() {
  const [info, setInfo] = useState<BinaryInfo | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/binary-info", {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
    if (res.ok) setInfo(await res.json());
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { info, reload: load };
}

/** Upload a binary via XHR so we get upload-progress events. */
function uploadBinaryFile(
  file: File,
  fieldname: "exe" | "mac",
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append(fieldname, file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/upload-app-binary");
    xhr.setRequestHeader("Authorization", `Bearer ${getAdminToken()}`);
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener("load", () => {
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(xhr.responseText || `HTTP ${xhr.status}`));
    });
    xhr.addEventListener("error", () => reject(new Error("Network error during upload.")));
    xhr.send(fd);
  });
}

// ── Direct Download Test Card ─────────────────────────────────────────────────

function DownloadTestCard({ binInfo }: { binInfo: BinaryInfo | null }) {
  const { toast } = useToast();

  function triggerDownload(url: string, filename: string) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function handleDownload(
    fileInfo: BinaryFileInfo | undefined,
    url: string,
    filename: string,
  ) {
    if (!fileInfo || isPlaceholder(fileInfo)) {
      toast({
        title: "ডাউনলোড প্রস্তুত নয়",
        description: "Software binary update in progress. Please check back shortly.",
        variant: "destructive",
      });
      return;
    }
    triggerDownload(url, filename);
  }

  const buttons: Array<{
    platform: "windows" | "mac";
    label: string;
    sublabel: string;
    icon: React.ReactNode;
    fileInfo: BinaryFileInfo | undefined;
    url: string;
    filename: string;
    colorClass: string;
    badgeClass: string;
  }> = [
    {
      platform: "windows",
      label: "Windows",
      sublabel: ".exe",
      icon: <Monitor className="w-5 h-5" />,
      fileInfo: binInfo?.exe,
      url: "/api/downloads/banglakhata-windows.exe",
      filename: "banglakhata-windows.exe",
      colorClass: "bg-blue-600 hover:bg-blue-700 text-white",
      badgeClass: binInfo?.exe && !isPlaceholder(binInfo.exe)
        ? "bg-blue-100 text-blue-700"
        : "bg-amber-100 text-amber-700",
    },
    {
      platform: "mac",
      label: "macOS / Linux",
      sublabel: ".dmg",
      icon: <Apple className="w-5 h-5" />,
      fileInfo: binInfo?.mac,
      url: "/api/downloads/banglakhata-mac.dmg",
      filename: "banglakhata-mac.dmg",
      colorClass: "bg-slate-700 hover:bg-slate-800 text-white",
      badgeClass: binInfo?.mac && !isPlaceholder(binInfo.mac)
        ? "bg-slate-100 text-slate-700"
        : "bg-amber-100 text-amber-700",
    },
  ];

  return (
    <Card className="shadow-sm border-none bg-white">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="p-2 bg-emerald-500/10 rounded-lg">
            <Download className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <CardTitle className="text-lg">ডাউনলোড টেস্ট বাটন</CardTitle>
            <CardDescription>
              প্রতিটি প্ল্যাটফর্মের ফাইল সরাসরি ডাউনলোড করে পরীক্ষা করুন
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 border-t">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {buttons.map((btn) => {
            const ready = btn.fileInfo && !isPlaceholder(btn.fileInfo);
            return (
              <button
                key={btn.platform}
                type="button"
                onClick={() => handleDownload(btn.fileInfo, btn.url, btn.filename)}
                className={`group flex flex-col items-center gap-3 rounded-xl p-5 transition-all ${
                  ready
                    ? `${btn.colorClass} shadow-sm hover:shadow-md`
                    : "bg-slate-100 text-slate-400 cursor-not-allowed"
                }`}
              >
                <div className={`p-3 rounded-full ${ready ? "bg-white/20" : "bg-slate-200"}`}>
                  {btn.icon}
                </div>
                <div className="text-center">
                  <div className="font-semibold text-sm">{btn.label}</div>
                  <div className={`text-xs mt-0.5 font-mono ${ready ? "opacity-75" : "text-slate-400"}`}>
                    {btn.sublabel}
                  </div>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${btn.badgeClass}`}>
                  {ready
                    ? `${fmtBytes(btn.fileInfo!.size)} · প্রস্তুত`
                    : "Placeholder"}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-4">
          Placeholder বাটনে ক্লিক করলে ডাউনলোড হবে না — একটি বার্তা দেখাবে।
          আসল ফাইল আপলোড হলে বাটন স্বয়ংক্রিয়ভাবে সক্রিয় হবে।
        </p>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  useAuthGuard();

  // ── OTP config ──────────────────────────────────────────────────────────────
  const { data: config, isLoading: otpLoading } = useGetAdminOtpConfig();
  const updateMutation = useUpdateAdminOtpConfig();
  const { data: blockedIps } = useListBlockedIps();
  const blockIp = useBlockIp();
  const unblockIp = useUnblockIp();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newIp, setNewIp] = useState("");
  const [ipReason, setIpReason] = useState("");
  const saveIp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!blockedIps?.policy.configured || !blockedIps.policy.clientIpAvailable) return;
    if (!window.confirm(`Block ${newIp}? This may affect everyone on a shared network.`)) return;
    blockIp.mutate({ data: { ip: newIp, reason: ipReason } }, {
      onSuccess: () => {
        setNewIp("");
        setIpReason("");
        void queryClient.invalidateQueries({ queryKey: getListBlockedIpsQueryKey() });
      },
      onError: () => toast({ variant: "destructive", title: "IP block failed", description: "Check the address and try again." }),
    });
  };

  const [otpEnabled, setOtpEnabled] = useState(true);
  const [otpSender, setOtpSender] = useState("");
  const isInitialized = useRef(false);

  useEffect(() => {
    if (config && !isInitialized.current) {
      setOtpEnabled(config.enabled);
      setOtpSender(config.sender);
      isInitialized.current = true;
    }
  }, [config]);

  const handleOtpSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(
      { data: { enabled: otpEnabled, sender: otpSender } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetAdminOtpConfigQueryKey(), updated);
          toast({ title: "Configuration Saved", description: "OTP settings updated." });
        },
        onError: (error) => {
          toast({ variant: "destructive", title: "Save Failed", description: error instanceof Error ? error.message : "Could not update the OTP configuration." });
        },
      }
    );
  };

  // ── Download config ─────────────────────────────────────────────────────────
  const { data: dlCfg, loading: dlLoading, saving: dlSaving, save: dlSave } = useDownloadConfig();

  const [windowsExeUrl,   setWindowsExeUrl]   = useState("");

  const dlInitialized = useRef(false);
  useEffect(() => {
    if (dlCfg && !dlInitialized.current) {
      setWindowsExeUrl(dlCfg.windowsExeUrl);
      dlInitialized.current = true;
    }
  }, [dlCfg]);

  const handleDlSave = (e: React.FormEvent) => {
    e.preventDefault();
    void dlSave({ windowsExeUrl });
  };

  // ── Binary file upload ──────────────────────────────────────────────────────
  const { info: binInfo, reload: reloadBinInfo } = useBinaryInfo();
  const exeInputRef = useRef<HTMLInputElement>(null);
  const macInputRef = useRef<HTMLInputElement>(null);
  const [exeProgress, setExeProgress] = useState<number | null>(null);
  const [macProgress, setMacProgress] = useState<number | null>(null);

  const handleFileUpload = useCallback(async (
    file: File,
    fieldname: "exe" | "mac",
    setProgress: (p: number | null) => void,
  ) => {
    setProgress(0);
    try {
      await uploadBinaryFile(file, fieldname, setProgress);
      toast({
        title: "আপলোড সফল ✓",
        description: `${file.name} (${fmtBytes(file.size)}) সফলভাবে সার্ভারে সংরক্ষিত হয়েছে।`,
      });
      setProgress(null);
      void reloadBinInfo();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "আপলোড ব্যর্থ",
        description: String(err),
      });
      setProgress(null);
    }
  }, [toast, reloadBinInfo]);

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (otpLoading || dlLoading) {
    return (
      <SidebarLayout>
        <div className="animate-pulse space-y-6 max-w-2xl">
          <div className="h-8 w-32 bg-muted rounded" />
          <div className="h-[300px] bg-muted rounded-xl" />
          <div className="h-[400px] bg-muted rounded-xl" />
        </div>
      </SidebarLayout>
    );
  }

  return (
    <SidebarLayout>
      <div className="space-y-6 max-w-2xl">
        <h2 className="text-2xl font-bold tracking-tight">System Settings</h2>
        <Card className="shadow-sm border-none bg-white">
          <CardHeader><CardTitle>Blocked network IPs</CardTitle>
            <CardDescription>Server-enforced for all sessions and OTP requests when a verified client-IP policy is configured. Shared networks can affect multiple people; blocking an IP is not a permanent device block.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p role="status" className={`rounded p-3 text-sm ${blockedIps?.policy.configured && blockedIps.policy.clientIpAvailable ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
              {blockedIps?.policy.message ?? "Checking client IP policy…"}
              {blockedIps?.policy.configured && !blockedIps.policy.clientIpAvailable &&
                " This request has no verifiable forwarded client IP; blocking is disabled."}
            </p>
            <form onSubmit={saveIp} className="flex flex-wrap gap-2">
              <Input className="flex-1 min-w-40" placeholder="IPv4 or IPv6 address" value={newIp}
                onChange={e => setNewIp(e.target.value)} disabled={!blockedIps?.policy.clientIpAvailable} required />
              <Input className="flex-1 min-w-40" placeholder="Reason (optional)" maxLength={500}
                value={ipReason} onChange={e => setIpReason(e.target.value)} />
              <Button type="submit" variant="destructive" disabled={blockIp.isPending || !blockedIps?.policy.clientIpAvailable}>Block IP</Button>
            </form>
            {blockedIps?.items.length === 0 && <p className="text-sm text-muted-foreground">No blocked IPs.</p>}
            {blockedIps?.items.map((entry) => <div key={entry.ip} className="flex items-center justify-between gap-2 border-t pt-2 text-sm">
              <span><strong className="font-mono">{entry.ip}</strong> {entry.reason && `· ${entry.reason}`}</span>
              <Button type="button" size="sm" variant="outline" disabled={unblockIp.isPending}
                onClick={() => unblockIp.mutate({ ip: entry.ip }, {
                  onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListBlockedIpsQueryKey() }); },
                  onError: () => toast({ variant: "destructive", title: "Unable to unblock IP" }),
                })}>Unblock</Button>
            </div>)}
          </CardContent>
        </Card>

        {/* ── Download & Store Links ─────────────────────────────────────── */}
        <form onSubmit={handleDlSave}>
          <Card className="shadow-sm border-none bg-white">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="p-2 bg-emerald-500/10 rounded-lg">
                  <Download className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <CardTitle className="text-lg">ডেস্কটপ ডাউনলোড সেটিংস</CardTitle>
                  <CardDescription>
                    কম্পিউটার সংস্করণের ডাউনলোড লিংক এখান থেকে কন্ট্রোল করুন
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-7 pt-4 border-t">

              {/* Windows desktop */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-semibold text-slate-700">Windows / কম্পিউটার</span>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Windows EXE Download URL
                  </label>
                  <Input
                    type="url"
                    placeholder="https://example.com/banglakhata-setup.exe  অথবা  /api/downloads/banglakhata-windows.exe"
                    value={windowsExeUrl}
                    onChange={e => setWindowsExeUrl(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    ফাঁকা রাখলে সার্ভারে রাখা .exe ফাইল ব্যবহার হবে।
                    Windows বাটনটি শুধু তখনই দেখাবে যখন URL বা ফাইল পাওয়া যাবে।
                  </p>
                </div>
              </div>

            </CardContent>

            <CardFooter className="bg-slate-50 border-t py-4 px-6 flex justify-between items-center rounded-b-xl">
              <div className="text-xs text-muted-foreground">
                {dlCfg?.updatedAt ? `Last updated: ${formatDate(dlCfg.updatedAt)}` : "No changes saved yet"}
              </div>
              <Button type="submit" disabled={dlSaving} className="bg-emerald-600 hover:bg-emerald-700">
                <Save className="w-4 h-4 mr-2" />
                {dlSaving ? "সংরক্ষণ হচ্ছে…" : "পরিবর্তন সংরক্ষণ করুন"}
              </Button>
            </CardFooter>
          </Card>
        </form>

        {/* ── Desktop Software File Upload ───────────────────────────────── */}
        <Card className="shadow-sm border-none bg-white">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-2 bg-violet-500/10 rounded-lg">
                <FileUp className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                  <CardTitle className="text-lg">ডেস্কটপ সফটওয়্যার আপলোড</CardTitle>
                <CardDescription>
                    Windows এবং macOS সফটওয়্যার সরাসরি সার্ভারে আপলোড করুন
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6 pt-4 border-t">

            {/* Hidden file inputs */}
            <input
              ref={exeInputRef}
              type="file"
              accept=".exe"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) void handleFileUpload(f, "exe", setExeProgress);
                e.target.value = "";
              }}
            />
            <input
              ref={macInputRef}
              type="file"
              accept=".dmg,.zip"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) void handleFileUpload(f, "mac", setMacProgress);
                e.target.value = "";
              }}
            />

            {/* ── Windows EXE ────────────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-semibold text-slate-700">💻 Windows Software (.exe)</span>
              </div>

              {/* Current file status badge */}
              {binInfo?.exe ? (
                isPlaceholder(binInfo.exe) ? (
                  <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Placeholder file active ({fmtBytes(binInfo.exe.size)}) — real EXE আপলোড করুন
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      EXE আপলোড হয়েছে · {fmtBytes(binInfo.exe.size)}
                      {binInfo.exe.mtime
                        ? ` · Last updated: ${new Date(binInfo.exe.mtime).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                        : ""}
                    </span>
                  </div>
                )
              ) : (
                <div className="h-8 w-64 bg-slate-100 animate-pulse rounded-lg" />
              )}

              {/* Upload button or progress bar */}
              {exeProgress !== null ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>আপলোড হচ্ছে…</span>
                    <span className="font-medium tabular-nums">{exeProgress}%</span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-200 ease-linear rounded-full"
                      style={{ width: `${exeProgress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 border-blue-200 text-blue-700 hover:bg-blue-50 hover:border-blue-300"
                  onClick={() => exeInputRef.current?.click()}
                >
                  <Upload className="w-4 h-4" />
                  Windows EXE আপলোড করুন
                </Button>
              )}
            </div>

            <div className="border-t" />

            {/* ── macOS / Linux DMG ──────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Apple className="w-4 h-4 text-slate-600" />
                <span className="text-sm font-semibold text-slate-700">🍎 macOS / Linux (.dmg / .zip)</span>
              </div>

              {/* Current file status badge */}
              {binInfo?.mac ? (
                isPlaceholder(binInfo.mac) ? (
                  <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Placeholder file active ({fmtBytes(binInfo.mac.size)}) — real DMG আপলোড করুন
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-slate-50 text-slate-700 border border-slate-200">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      DMG আপলোড হয়েছে · {fmtBytes(binInfo.mac.size)}
                      {binInfo.mac.mtime
                        ? ` · Last updated: ${new Date(binInfo.mac.mtime).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                        : ""}
                    </span>
                  </div>
                )
              ) : (
                <div className="h-8 w-64 bg-slate-100 animate-pulse rounded-lg" />
              )}

              {/* Upload button or progress bar */}
              {macProgress !== null ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>আপলোড হচ্ছে…</span>
                    <span className="font-medium tabular-nums">{macProgress}%</span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-slate-500 transition-all duration-200 ease-linear rounded-full"
                      style={{ width: `${macProgress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300"
                  onClick={() => macInputRef.current?.click()}
                >
                  <Upload className="w-4 h-4" />
                  macOS DMG আপলোড করুন
                </Button>
              )}
            </div>

          </CardContent>

          <CardFooter className="bg-slate-50 border-t py-4 px-6 rounded-b-xl">
            <p className="text-xs text-muted-foreground">
              সর্বোচ্চ ফাইল সাইজ: <span className="font-medium">200 MB</span> ·
              আপলোড হওয়া ফাইল <span className="font-mono text-xs">/api/downloads/</span> পাথ থেকে সরাসরি ডাউনলোড হবে।
            </p>
          </CardFooter>
        </Card>

        {/* ── Direct Download Test Buttons ───────────────────────────────────── */}
        <DownloadTestCard binInfo={binInfo} />

        {/* ── OTP Gateway ───────────────────────────────────────────────────── */}
        <form onSubmit={handleOtpSave}>
          <Card className="shadow-sm border-none bg-white">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <MessageSquare className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">OTP Gateway Integration</CardTitle>
                  <CardDescription>Uses the secure connected Twilio account. Credentials are never entered or shown here.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-4 border-t">
              {config?.connectionError && <p role="alert" className="text-sm text-amber-700 bg-amber-50 p-3 rounded">{config.connectionError}</p>}
              <div className="text-sm space-y-2">
                <p>Twilio account: <strong>{config?.twilio?.status ?? "Unavailable"}</strong></p>
                <p>Live account balance: <strong>{config?.twilio?.balance != null
                  ? `${config.twilio.balance} ${config.twilio.currency ?? ""}` : "Unavailable from provider"}</strong></p>
                <p className="text-xs text-muted-foreground">Balance is in account currency, not remaining SMS messages or prepaid top-up count. No chargeable test message is sent here.</p>
              </div>
              <label className="flex items-center gap-3 text-sm font-medium">
                <input type="checkbox" checked={otpEnabled} onChange={e => setOtpEnabled(e.target.checked)} />
                Enable phone OTP sign-in and verification
              </label>
              <div className="space-y-2">
                <label className="text-sm font-semibold">SMS sender</label>
                <select className="w-full rounded-md border p-2 text-sm bg-white" value={otpSender} onChange={e => setOtpSender(e.target.value)}>
                  <option value="">Automatic (only when one SMS-capable sender exists)</option>
                  {config?.twilio?.senders.map((sender) => <option key={sender} value={sender}>{sender}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">Only numbers verified as SMS-capable on your connected Twilio account can be selected.</p>
              </div>
            </CardContent>
            <CardFooter className="bg-slate-50 border-t py-4 px-6 flex justify-between items-center rounded-b-xl">
              <div className="text-xs text-muted-foreground">
                Last updated: {formatDate(config?.updatedAt)}
              </div>
              <Button type="submit" disabled={updateMutation.isPending}>
                <Save className="w-4 h-4 mr-2" />
                {updateMutation.isPending ? "Saving..." : "Save Configuration"}
              </Button>
            </CardFooter>
          </Card>
        </form>

      </div>
    </SidebarLayout>
  );
}
