import { useAuthGuard } from "@/lib/auth";
import { SidebarLayout } from "@/components/layout/sidebar";
import { useGetAdminUser, useUpdateAdminUser, getGetAdminUserQueryKey } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowLeft, User, Phone, Calendar, Smartphone, Shield, Building2, Ban, CheckCircle2 } from "lucide-react";
import { formatDate } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/use-toast";

export default function UserDetailPage() {
  useAuthGuard();
  const params = useParams();
  const id = params.id as string;
  const { data: user, isLoading } = useGetAdminUser(id, { query: { enabled: !!id } });
  const updateMutation = useUpdateAdminUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  if (isLoading || !user) {
    return (
      <SidebarLayout>
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-32 bg-muted rounded"></div>
          <div className="h-64 bg-muted rounded-xl"></div>
        </div>
      </SidebarLayout>
    );
  }

  const handleToggleStatus = () => {
    const newStatus = user.status === 'active' ? 'suspended' : 'active';
    updateMutation.mutate(
      { userId: id, data: { status: newStatus } },
      {
        onSuccess: (updatedUser) => {
          queryClient.setQueryData(getGetAdminUserQueryKey(id), updatedUser);
          toast({
            title: "Status Updated",
            description: `User has been ${newStatus}.`,
          });
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: "Update Failed",
            description: "Could not update user status.",
          });
        }
      }
    );
  };

  return (
    <SidebarLayout>
      <div className="space-y-6 max-w-5xl">
        <div className="flex items-center gap-4">
          <Link href="/users">
            <Button variant="outline" size="icon" className="h-8 w-8 bg-white">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h2 className="text-2xl font-bold tracking-tight">User Details</h2>
          <Badge variant={user.status === 'active' ? 'success' : 'destructive'} className="ml-auto">
            {user.status}
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="col-span-1 md:col-span-2 shadow-sm border-none bg-white">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="h-5 w-5 text-primary" /> Profile Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-8">
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Full Name</div>
                  <div className="text-lg font-semibold">{user.name || "Not provided"}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Phone Number</div>
                  <div className="text-lg font-semibold font-mono flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground" /> {user.phone}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Internal ID</div>
                  <div className="text-sm font-mono bg-slate-100 p-1.5 rounded">{user.id}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Joined Date</div>
                  <div className="text-base flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" /> {formatDate(user.createdAt)}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Last Login</div>
                  <div className="text-base">{formatDate(user.lastLogin)}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Login Info</div>
                  <div className="flex gap-2">
                    <Badge variant="secondary" className="uppercase text-[10px]"><Smartphone className="w-3 h-3 mr-1"/> {user.loginSource}</Badge>
                    <Badge variant="outline" className="uppercase text-[10px]"><Shield className="w-3 h-3 mr-1"/> {user.authProvider}</Badge>
                  </div>
                </div>
                <div className="col-span-1 sm:col-span-2">
                  <div className="text-sm font-medium text-muted-foreground mb-1">Device Meta</div>
                  <div className="text-xs font-mono bg-slate-900 text-slate-300 p-3 rounded-md break-all">
                    {user.deviceMeta || "No data"}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-none bg-white h-fit">
            <CardHeader className="pb-4 border-b">
              <CardTitle className="text-lg">Administration</CardTitle>
              <CardDescription>Manage user access</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="p-4 bg-slate-50 rounded-lg border">
                  <div className="text-sm font-semibold mb-2">Account Status</div>
                  <p className="text-xs text-muted-foreground mb-4">
                    {user.status === 'active' 
                      ? "User currently has full access to the platform. Suspending will instantly block API access."
                      : "User is suspended and cannot log in or make API calls."}
                  </p>
                  <Button 
                    variant={user.status === 'active' ? "destructive" : "default"} 
                    className="w-full"
                    onClick={handleToggleStatus}
                    disabled={updateMutation.isPending}
                  >
                    {user.status === 'active' ? (
                      <><Ban className="w-4 h-4 mr-2" /> Suspend User</>
                    ) : (
                      <><CheckCircle2 className="w-4 h-4 mr-2" /> Reactivate User</>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="col-span-1 md:col-span-3 space-y-4">
            <h3 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" /> Owned Businesses ({user.businesses?.length || 0})
            </h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {user.businesses?.length === 0 ? (
                <div className="col-span-full py-8 text-center text-muted-foreground bg-white border rounded-xl border-dashed">
                  This user hasn't created any businesses yet.
                </div>
              ) : (
                user.businesses?.map((biz) => (
                  <Card key={biz.id} className="shadow-sm border-slate-200">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base truncate" title={biz.name}>{biz.name}</CardTitle>
                      <CardDescription className="text-xs">ID: {biz.id.split('-')[0]}...</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Parties</span>
                        <span className="font-semibold">{biz.partyCount}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm mt-2">
                        <span className="text-muted-foreground">Ledger Entries</span>
                        <span className="font-semibold">{biz.ledgerCount}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </SidebarLayout>
  );
}
