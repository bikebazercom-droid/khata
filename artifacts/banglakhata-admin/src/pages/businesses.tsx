import React, { useState, useEffect } from "react";
import { useAuthGuard } from "@/lib/auth";
import { SidebarLayout } from "@/components/layout/sidebar";
import { useListAdminBusinesses } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatShortDate, formatCurrency } from "@/lib/format";
import { Search, ChevronLeft, ChevronRight, Building2 } from "lucide-react";
import { useDebounce } from "@/lib/use-debounce";

export default function BusinessesPage() {
  useAuthGuard();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 500);

  const { data, isLoading } = useListAdminBusinesses({
    search: debouncedSearch,
    page,
    pageSize: 20
  });

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  return (
    <SidebarLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h2 className="text-2xl font-bold tracking-tight">Businesses</h2>
          
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by shop name, owner or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-white"
            />
          </div>
        </div>

        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead>Shop Name</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Parties</TableHead>
                <TableHead className="text-right">Entries</TableHead>
                <TableHead className="text-right">Total Volume</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Loading businesses...
                  </TableCell>
                </TableRow>
              ) : data?.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12">
                    <Building2 className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
                    <p className="text-muted-foreground">No businesses found</p>
                  </TableCell>
                </TableRow>
              ) : (
                data?.items.map((biz) => (
                  <TableRow key={biz.id} className="hover:bg-slate-50/50">
                    <TableCell className="font-medium text-primary">
                      {biz.name}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm">{biz.ownerName || "Unknown"}</span>
                        <span className="text-xs text-muted-foreground">{biz.ownerPhone}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">{biz.partyCount}</TableCell>
                    <TableCell className="text-right font-medium">{biz.ledgerCount}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-600">
                      {formatCurrency(biz.transactionVolume)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm">
                      {formatShortDate(biz.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          
          {data && data.total > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-slate-50">
              <div className="text-sm text-muted-foreground">
                Showing <span className="font-medium text-foreground">{(page - 1) * 20 + 1}</span> to <span className="font-medium text-foreground">{Math.min(page * 20, data.total)}</span> of <span className="font-medium text-foreground">{data.total}</span>
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
