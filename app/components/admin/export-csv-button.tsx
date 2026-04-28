"use client";

import { Download } from "lucide-react";
import { Button } from "../ui/button";
import { useWallet } from "../../lib/wallet/context";

type ExportCsvButtonProps = {
  href: string;
  label?: string;
};

export function ExportCsvButton({ href, label = "Export CSV" }: ExportCsvButtonProps) {
  const { wallet } = useWallet();
  const wallet_address = wallet?.account.address;
  const finalHref = wallet_address
    ? href.includes("?")
      ? `${href}&wallet=${encodeURIComponent(wallet_address)}`
      : `${href}?wallet=${encodeURIComponent(wallet_address)}`
    : href;

  return (
    <Button asChild variant="secondary" size="sm">
      <a href={finalHref} download>
        <Download className="h-4 w-4" />
        {label}
      </a>
    </Button>
  );
}
