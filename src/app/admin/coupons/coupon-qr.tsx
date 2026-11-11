"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

// Scanning opens the claim page for this code. The image carries its own white background so it scans in dark mode too.
export function CouponQr({ code }: Readonly<{ code: string }>) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(`${window.location.origin}/claim/${code}`, { width: 480, margin: 2 })
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [code]);

  return (
    <div className="flex flex-col items-center gap-2">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a generated data URL, nothing for next/image to optimize
        <img src={src} alt={`QR code to claim coupon ${code}`} width={192} height={192} className="h-48 w-48 rounded-control" />
      ) : (
        <div aria-hidden="true" className="h-48 w-48 animate-pulse rounded-control bg-muted motion-reduce:animate-none" />
      )}
      {src && (
        <a href={src} download={`coupon-${code}.png`} className="text-[13px] font-semibold underline underline-offset-4 hover:text-foreground/80">
          Download QR image
        </a>
      )}
    </div>
  );
}
