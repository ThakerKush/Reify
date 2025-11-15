import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DataStreamProvider } from "@/components/data-stream-provider";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
      <DataStreamProvider>
        {children}
      </DataStreamProvider>
  );
}
