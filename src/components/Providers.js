'use client';

import { SessionProvider } from "next-auth/react";
import { AppProvider } from "@/context/AppContext";
import { OSProvider } from "@/context/OSContext";
import { VaultProvider } from "@/context/VaultContext";
import MasterPasswordModal from "@/components/MasterPasswordModal";
import '@/lib/i18n';

export function Providers({ children }) {
  return (
    <SessionProvider>
      <VaultProvider>
        <OSProvider>
          <AppProvider>
            {children}
            <MasterPasswordModal />
          </AppProvider>
        </OSProvider>
      </VaultProvider>
    </SessionProvider>
  );
}
