import { AdminLocaleProvider } from "@/components/admin/AdminLocaleProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { AdminShell } from "@/components/layout/AdminShell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminLocaleProvider>
      <ToastProvider>
        <AdminShell>{children}</AdminShell>
      </ToastProvider>
    </AdminLocaleProvider>
  );
}
