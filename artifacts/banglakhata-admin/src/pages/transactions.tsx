import React, { useState, useEffect } from "react";
import { useAuthGuard } from "@/lib/auth";
import { SidebarLayout } from "@/components/layout/sidebar";
import { useListAdminTransactions } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatCurrency } from "@/lib/format";
import { Search, ChevronLeft, ChevronRight, ReceiptText, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useDebounce } from "@/lib/use-debounce";

export default function TransactionsPage() {
  useAuthGuard();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 500);

  const { data, isLoading } = useListAdminTransactions({
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
          <h2 className="text-2xl font-bold tracking-tight">Global Ledger Feed</h2>
          
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search descriptions, names, phones..."
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
                <TableHead>Date & Time</TableHead>
                <TableHead>Business</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Loading feed...
                  </TableCell>
                </TableRow>
              ) : data?.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12">
                    <ReceiptText className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
                    <p className="text-muted-foreground">No transactions found</p>
                  </TableCell>
                </TableRow>
              ) : (
                data?.items.map((tx) => (
                  <TableRow key={tx.id} className="hover:bg-slate-50/50">
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(tx.createdAt)}
                    </TableCell>
                    <TableCell className="font-medium">
                      {tx.businessName}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm">{tx.partyName}</span>
                        <span className="text-xs text-muted-foreground">{tx.partyPhone}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm truncate max-w-[200px] block" title={tx.description}>
                        {tx.description || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {tx.type === 'YOU_GOT' ? (
                        <Badge variant="outline" className="text-emerald-600 bg-emerald-50 border-emerald-200">
                          <ArrowDownRight className="w-3 h-3 mr-1" /> IN
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-rose-600 bg-rose-50 border-rose-200">
                          <ArrowUpRight className="w-3 h-3 mr-1" /> OUT
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className={`text-right font-mono font-medium ${tx.type === 'YOU_GOT' ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {tx.type === 'YOU_GOT' ? '+' : '-'}{formatCurrency(tx.amount)}
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
