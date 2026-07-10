import { invokeTauri } from "../../services/tauri";

export type VoiceState = "idle" | "recording" | "processing" | "unavailable" | "error";

export interface VoiceRecording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

/** Explicit, bounded push-to-talk recorder. No microphone is opened on boot. */
export class PushToTalkRecorder {
  private recorder: MediaRecorder | undefined;
  private stream: MediaStream | undefined;
  private startedAt = 0;

  public async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("Voice recording is not available in this webview.");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const mimeType = pickMimeType();
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.startedAt = Date.now();
    this.recorder.start();
  }

  public async stop(): Promise<VoiceRecording | null> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive") {
      this.cleanup();
      return null;
    }

    const recording = await new Promise<VoiceRecording>((resolve) => {
      const chunks: BlobPart[] = [];
      recorder.addEventListener("dataavailable", (event) => chunks.push(event.data));
      recorder.addEventListener(
        "stop",
        () => {
          resolve({
            blob: new Blob(chunks, { type: recorder.mimeType || "audio/webm" }),
            mimeType: recorder.mimeType || "audio/webm",
            durationMs: Date.now() - this.startedAt,
          });
        },
        { once: true },
      );
      recorder.stop();
    });
    this.cleanup();
    return recording;
  }

  public cancel(): void {
    if (this.recorder?.state === "recording") {
      this.recorder.stop();
    }
    this.cleanup();
  }

  private cleanup(): void {
    this.recorder = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
  }
}

/** Audio is sent only to the optional native provider, never to frontend env vars. */
export async function transcribeExplicitRecording(
  recording: VoiceRecording,
): Promise<string | null> {
  const data = new Uint8Array(await recording.blob.arrayBuffer());
  const result = await invokeTauri<{ transcript?: string | null }>("transcribe_audio", {
    audio: Array.from(data),
    mimeType: recording.mimeType,
    durationMs: recording.durationMs,
    explicitPushToTalk: true,
  });
  return result?.transcript?.trim() || null;
}

function pickMimeType(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((value) => MediaRecorder.isTypeSupported(value));
}
