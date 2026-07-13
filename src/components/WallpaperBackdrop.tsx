import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes } from "react";
import type { WallpaperLibraryItem } from "../services/types";

export interface WallpaperBackdropProps extends HTMLAttributes<HTMLDivElement> {
  active?: WallpaperLibraryItem | null;
  paused?: boolean;
  transitionMs?: number;
  onAssetError?: (id: string) => void;
}

interface WallpaperLayers {
  current: WallpaperLibraryItem | null;
  previous: WallpaperLibraryItem | null;
}

/**
 * Webview-native image/video wallpaper renderer. The internal gradient is
 * always present below managed media, so a slow or failed file never creates a
 * blank surface. Incoming and outgoing media overlap only for the crossfade.
 */
export function WallpaperBackdrop({
  active = null,
  paused = false,
  transitionMs = 1_400,
  onAssetError,
  className = "",
  style,
  ...props
}: WallpaperBackdropProps) {
  const [layers, setLayers] = useState<WallpaperLayers>({
    current: active,
    previous: null,
  });

  if (
    layers.current?.id !== active?.id ||
    layers.current?.src !== active?.src ||
    layers.current?.kind !== active?.kind
  ) {
    setLayers({ current: active, previous: layers.current });
  }

  useEffect(() => {
    if (!layers.previous) return;
    const timer = window.setTimeout(
      () => setLayers((current) => ({ ...current, previous: null })),
      transitionMs,
    );
    return () => window.clearTimeout(timer);
  }, [layers.current?.id, layers.previous, transitionMs]);

  const backdropStyle = {
    ...style,
    "--wallpaper-transition-ms": `${Math.max(0, transitionMs)}ms`,
  } as CSSProperties;

  return (
    <div
      {...props}
      className={`wallpaper-backdrop ${className}`}
      style={backdropStyle}
      aria-hidden="true"
    >
      <div className="wallpaper-backdrop__fallback" />
      {layers.previous ? (
        <WallpaperMediaLayer
          asset={layers.previous}
          className="wallpaper-backdrop__media--outgoing"
          paused={paused}
        />
      ) : null}
      {layers.current ? (
        <WallpaperMediaLayer
          asset={layers.current}
          className="wallpaper-backdrop__media--incoming"
          paused={paused}
          onAssetError={onAssetError}
        />
      ) : null}
      <div className="wallpaper-backdrop__wash" />
    </div>
  );
}

interface WallpaperMediaLayerProps {
  asset: WallpaperLibraryItem;
  className: string;
  paused: boolean;
  onAssetError?: (id: string) => void;
}

function WallpaperMediaLayer({ asset, className, paused, onAssetError }: WallpaperMediaLayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const reportedError = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) {
      video.pause();
      return;
    }
    void video.play().catch(() => {
      if (!reportedError.current) {
        reportedError.current = true;
        onAssetError?.(asset.id);
      }
    });
  }, [asset.id, onAssetError, paused]);

  const handleError = () => {
    if (reportedError.current) return;
    reportedError.current = true;
    onAssetError?.(asset.id);
  };

  if (asset.kind === "video") {
    return (
      <video
        className={`wallpaper-backdrop__media ${className}`}
        key={asset.id}
        ref={videoRef}
        src={asset.src}
        autoPlay={!paused}
        loop
        muted
        playsInline
        preload="auto"
        onError={handleError}
      />
    );
  }
  return (
    <img
      alt=""
      className={`wallpaper-backdrop__media ${className}`}
      decoding="async"
      key={asset.id}
      src={asset.src}
      onError={handleError}
    />
  );
}
