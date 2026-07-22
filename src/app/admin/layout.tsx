import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { AdminHeader } from "@/components/layout/AdminHeader";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-primary">
      <AdminHeader />

      <div className="flex">
        <AdminSidebar />
        <main className="ml-56 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
