"use client";

import { useEffect, useRef, useState } from "react";
import { ScanLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { couponCodeFrom } from "@/lib/utils";

// Scan a coupon QR from inside the app; the code goes straight onto the list
export function CouponScanButton({ onCode, disabled }: Readonly<{ onCode: (code: string) => void; disabled?: boolean }>) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" disabled={disabled} onClick={() => setOpen(true)} aria-label="Scan coupon QR code" title="Scan QR">
        <ScanLine aria-hidden="true" className="h-5 w-5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Scan coupon" description="Point your camera at the coupon's QR code.">
        {open && (
          <Scanner
            onCode={(code) => {
              setOpen(false);
              onCode(code);
            }}
          />
        )}
      </Dialog>
    </>
  );
}

const MAX_SCAN_WIDTH = 640; // decoding full-resolution frames is slow on phones and no more accurate

function cameraError(error: unknown) {
  const name = (error as { name?: string } | null)?.name;
  if (name === "NO_CAMERA_API") return "This browser can't use the camera here. It needs a secure (https) connection. Type the code instead.";
  if (name === "NotAllowedError") return "Camera access is blocked. Allow it in your browser's site settings, or type the code instead.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found. Type the code instead.";
  return "The camera couldn't start. Type the code instead.";
}

function Scanner({ onCode }: Readonly<{ onCode: (code: string) => void }>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  const [error, setError] = useState("");
  const [ignored, setIgnored] = useState(false);

  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let frame = 0;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("no camera api"), { name: "NO_CAMERA_API" });
        const [{ default: jsQR }, media] = await Promise.all([
          import("jsqr"),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }),
        ]);
        stream = media;
        const video = videoRef.current;
        // Closed while the camera was starting: cleanup already ran, so turn it off here
        if (stopped || !video || !context) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = media;
        await video.play();

        const tick = () => {
          if (stopped) return;
          if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
            const scale = Math.min(1, MAX_SCAN_WIDTH / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const image = context.getImageData(0, 0, canvas.width, canvas.height);
            const hit = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
            if (hit) {
              const code = couponCodeFrom(hit.data);
              if (code) {
                onCodeRef.current(code);
                return;
              }
              setIgnored(true); // a QR, but not a coupon one; keep looking
            }
          }
          frame = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        if (!stopped) setError(cameraError(err));
      }
    })();

    // Closing the dialog always turns the camera off
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  if (error) {
    return <p role="alert" className="py-4 text-sm font-semibold text-destructive">{error}</p>;
  }

  return (
    <div className="space-y-2 py-2">
      <video ref={videoRef} muted playsInline aria-label="Camera view" className="aspect-square w-full rounded-control bg-muted object-cover" />
      <p aria-live="polite" className="text-center text-xs text-muted-foreground">
        {ignored ? "That QR code isn't a Pantry coupon. Try the coupon's code." : "Looking for a QR code…"}
      </p>
    </div>
  );
}
