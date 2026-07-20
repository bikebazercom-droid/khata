import { useState } from "react";
import { useLocation } from "wouter";
import { useAdminLogin } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setAdminAuth } from "@/lib/auth";
import { Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const loginMutation = useAdminLogin();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate(
      { data: { username, password } },
      {
        onSuccess: (data) => {
          setAdminAuth(data.token, data.expiresAt);
          setLocation("/dashboard");
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: "Login Failed",
            description: "Invalid credentials.",
          });
        },
      }
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-sm border-none shadow-xl bg-white">
        <CardHeader className="space-y-3 text-center pb-8 pt-8">
          <div className="mx-auto w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-2">
            <span className="text-xl font-bold text-accent">BK</span>
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Admin Console</CardTitle>
          <CardDescription className="text-slate-500">
            Sign in to access BanglaKhata platform operations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Username</label>
              <Input
                type="text"
                placeholder="admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Password</label>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-11"
              />
            </div>
            <Button 
              type="submit" 
              className="w-full h-11 text-base font-medium mt-6" 
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                "Sign In"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
