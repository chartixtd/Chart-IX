import { AdminLocaleProvider } from "@/components/admin/AdminLocaleProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { AdminHeader } from "@/components/layout/AdminHeader";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminLocaleProvider>
      <ToastProvider>
        <div className="min-h-screen bg-bg-primary">
          <AdminHeader />
          <div className="flex">
            <AdminSidebar />
            <main className="ml-56 flex-1 p-6">{children}</main>
          </div>
        </div>
      </ToastProvider>
    </AdminLocaleProvider>
  );
}
