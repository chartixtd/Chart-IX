import { AdminSidebar } from "@/components/layout/AdminSidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Top bar */}
      <header className="sticky top-0 z-40 h-14 border-b border-border-default bg-bg-primary/80 backdrop-blur-xl flex items-center px-4">
        <span className="text-lg font-bold">
          <span className="gold-text">Chart</span>
          <span className="text-text-primary">-IX</span>
        </span>
        <span className="ml-2 rounded-sm border border-gold/30 bg-gold/10 px-2 py-0.5 text-xs font-medium text-gold">
          Admin
        </span>
      </header>

      <div className="flex">
        <AdminSidebar />
        <main className="ml-56 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
