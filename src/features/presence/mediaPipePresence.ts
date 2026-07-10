import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

export type CameraPresenceState =
  "disabled" | "requesting" | "starting" | "ready" | "denied" | "unsupported" | "error";

export interface CameraPresenceSnapshot {
  state: CameraPresenceState;
  message: string;
}

export interface MediaPipePresenceOptions {
  onSample: (detected: boolean, at: number) => void;
  onStatus: (snapshot: CameraPresenceSnapshot) => void;
  sampleIntervalMs?: number;
}

/**
 * Local-only camera pipeline. It never draws, stores, uploads, or logs a
 * frame. The 320×180 input and one-second cadence respect the target laptop.
 */
export class MediaPipePresenceController {
  private detector: FaceDetector | undefined;
  private stream: MediaStream | undefined;
  private video: HTMLVideoElement | undefined;
  private timer: number | undefined;
  private active = false;

  public async start(options: MediaPipePresenceOptions): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      options.onStatus({ state: "unsupported", message: "This webview does not expose a camera." });
      return;
    }

    this.stop();
    this.active = true;
    options.onStatus({ state: "requesting", message: "Requesting camera permission…" });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 320, max: 640 },
          height: { ideal: 180, max: 360 },
          frameRate: { ideal: 8, max: 12 },
          facingMode: "user",
        },
      });
    } catch (error) {
      const denied =
        error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name);
      options.onStatus({
        state: denied ? "denied" : "error",
        message: denied
          ? "Camera permission was denied. Use the display shortcut or browser input to wake."
          : "Camera could not start.",
      });
      this.stop();
      return;
    }

    if (!this.active || !this.stream) {
      // A user may disable presence while a permission prompt is open. A
      // granted stream can still resolve after that, so release it before
      // returning rather than leaving a hidden camera track alive.
      this.stop();
      return;
    }

    options.onStatus({ state: "starting", message: "Starting local face detection…" });
    try {
      this.video = document.createElement("video");
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.width = 320;
      this.video.height = 180;
      this.video.srcObject = this.stream;
      await this.video.play();

      const vision = await FilesetResolver.forVisionTasks("/mediapipe");
      this.detector = await FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "/models/face_detector.tflite" },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.5,
        minSuppressionThreshold: 0.3,
      });

      if (!this.active || !this.detector || !this.video) {
        // Model creation may outlive an opt-out. Close the detector that just
        // resolved instead of retaining a native vision resource.
        this.stop();
        return;
      }
      const sample = () => {
        if (
          !this.active ||
          !this.detector ||
          !this.video ||
          this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          return;
        }
        try {
          const result = this.detector.detectForVideo(this.video, performance.now());
          options.onSample(result.detections.length > 0, Date.now());
        } catch {
          // A short-lived camera frame failure must not interrupt the display.
          options.onSample(false, Date.now());
        }
      };
      sample();
      this.timer = window.setInterval(sample, options.sampleIntervalMs ?? 1_000);
      options.onStatus({
        state: "ready",
        message: "Face detection is local and frames are never stored.",
      });
    } catch {
      options.onStatus({
        state: "error",
        message:
          "Face detector could not start. Use the display shortcut or browser input to wake.",
      });
      this.stop();
    }
  }

  public stop(): void {
    this.active = false;
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
    this.detector?.close();
    this.detector = undefined;
    if (this.video) {
      this.video.srcObject = null;
    }
    this.video?.pause();
    this.video?.removeAttribute("src");
    this.video = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
  }
}
