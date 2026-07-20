import React, { useState, useEffect, useRef } from "react";
import { useAuthGuard } from "@/lib/auth";
import { SidebarLayout } from "@/components/layout/sidebar";
import { useGetAdminOtpConfig, useUpdateAdminOtpConfig, getGetAdminOtpConfigQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Save, KeyRound, Server, Coins } from "lucide-react";
import { formatDate } from "@/lib/format";

export default function SettingsPage() {
  useAuthGuard();
  const { data: config, isLoading } = useGetAdminOtpConfig();
  const updateMutation = useUpdateAdminOtpConfig();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [gatewayUrl, setGatewayUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [remainingBalance, setRemainingBalance] = useState("0");
  
  const isInitialized = useRef(false);

  useEffect(() => {
    if (config && !isInitialized.current) {
      setGatewayUrl(config.gatewayUrl);
      setRemainingBalance(config.remainingBalance.toString());
      isInitialized.current = true;
    }
  }, [config]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(
      { 
        data: { 
          gatewayUrl, 
          apiKey, 
          remainingBalance: Number(remainingBalance) 
        } 
      },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetAdminOtpConfigQueryKey(), updated);
          setApiKey(""); // clear the input field as it's secret
          toast({
            title: "Configuration Saved",
            description: "OTP gateway settings have been updated successfully.",
          });
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: "Save Failed",
            description: "Could not update the OTP configuration.",
          });
        }
      }
    );
  };

  if (isLoading) {
    return (
      <SidebarLayout>
        <div className="animate-pulse space-y-6 max-w-2xl">
          <div className="h-8 w-32 bg-muted rounded"></div>
          <div className="h-[400px] bg-muted rounded-xl"></div>
        </div>
      </SidebarLayout>
    );
  }

  return (
    <SidebarLayout>
      <div className="space-y-6 max-w-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">System Settings</h2>
        </div>

        <form onSubmit={handleSave}>
          <Card className="shadow-sm border-none bg-white">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <MessageSquare className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">OTP Gateway Integration</CardTitle>
                  <CardDescription>Configure the SMS provider for user authentication</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-4 border-t">
              <div className="space-y-3">
                <label className="text-sm font-semibold flex items-center gap-2">
                  <Server className="w-4 h-4 text-muted-foreground" /> Gateway URL
                </label>
                <Input
                  type="url"
                  placeholder="https://api.sms-provider.com/v3/send"
                  value={gatewayUrl}
                  onChange={(e) => setGatewayUrl(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">The endpoint for dispatching SMS messages.</p>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-semibold flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-muted-foreground" /> API Key
                </label>
                <div className="flex gap-2 items-center">
                  <Input
                    type="password"
                    placeholder={config?.apiKeyHint ? `••••••••••••${config.apiKeyHint}` : "Enter new API key..."}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground">Leave blank to keep the current key.</p>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-semibold flex items-center gap-2">
                  <Coins className="w-4 h-4 text-muted-foreground" /> Remaining Balance Alert
                </label>
                <Input
                  type="number"
                  min="0"
                  value={remainingBalance}
                  onChange={(e) => setRemainingBalance(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">Update the manual remaining balance count (optional).</p>
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
