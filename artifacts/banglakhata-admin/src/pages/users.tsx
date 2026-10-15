import React, { useState, useEffect } from "react";
import { SidebarLayout } from "@/components/layout/sidebar";
import { useListAdminUsers, getListAdminUsersQueryKey } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatShortDate } from "@/lib/format";
import { Link } from "wouter";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { useDebounce } from "@/lib/use-debounce";

export default function UsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 500);

  const { data, isLoading, isError, refetch } = useListAdminUsers({
    search: debouncedSearch,
    page,
    pageSize: 20
  }, { query: { queryKey: getListAdminUsersQueryKey({ search: debouncedSearch, page, pageSize: 20 }), refetchInterval: 30_000 } });

  // Reset page when search changes
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  return (
    <SidebarLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h2 className="text-2xl font-bold tracking-tight">Users</h2>
          
          <div className="flex w-full sm:w-auto items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email or phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-white"
              />
            </div>
          </div>
        </div>

        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          {isError && (
            <p role="alert" className="border-b bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-3">
              <span>Could not load the user list.</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>Retry</Button>
            </p>
          )}
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email / phone</TableHead>
                <TableHead>Auth method</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Active now</TableHead>
                <TableHead className="text-right">Joined</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Loading users...
                  </TableCell>
                </TableRow>
              ) : !data ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No user data is available.
                  </TableCell>
                </TableRow>
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No users found
                  </TableCell>
                </TableRow>
              ) : (
                data?.items.map((user) => (
                  <TableRow key={user.id} className="hover:bg-slate-50/50">
                    <TableCell className="font-medium">
                      <div className="flex flex-col">
                        <span>{user.name || "Unknown"}</span>
                        <span className="text-xs text-muted-foreground font-mono truncate max-w-[120px]" title={user.id}>{user.id.split('-')[0]}...</span>
                      </div>
                    </TableCell>
                    <TableCell><div>{user.email ?? "—"}</div><div className="text-xs text-muted-foreground">{user.phone ?? "—"}</div></TableCell>
                    <TableCell>
                      <div className="flex gap-1.5 flex-wrap">
                        <Badge variant="outline" className="text-[10px] uppercase text-muted-foreground">{user.authProvider}</Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.status === 'active' ? 'success' : 'destructive'}>
                        {user.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">{user.isOnline ? "● Online" : "Offline"}</TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm">{formatShortDate(user.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/users/${user.id}`}>
                        <Button variant="ghost" size="sm" className="text-primary hover:text-primary">
                          View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          
          {data && data.total > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-slate-50">
              <div className="text-sm text-muted-foreground">
                Showing <span className="font-medium text-foreground">{(page - 1) * 20 + 1}</span> to <span className="font-medium text-foreground">{Math.min(page * 20, data.total)}</span> of <span className="font-medium text-foreground">{data.total}</span> users
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> Prev
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setPage(p => p + 1)}
                  disabled={page * 20 >= data.total}
                >
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </SidebarLayout>
  );
}
