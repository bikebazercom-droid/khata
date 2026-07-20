import { SidebarLayout } from "@/components/layout/sidebar";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
      <div className="max-w-md space-y-6">
        <h1 className="text-9xl font-bold text-primary">404</h1>
        <h2 className="text-2xl font-semibold tracking-tight">Page not found</h2>
        <p className="text-muted-foreground">
          The page you are looking for doesn't exist or has been moved.
        </p>
        <Link href="/dashboard">
          <Button size="lg" className="mt-8">
            Return to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}
