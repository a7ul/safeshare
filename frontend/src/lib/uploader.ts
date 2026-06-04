import { Upload } from "tus-js-client";

export interface UploadCallbacks {
  onProgress: (fraction: number) => void;
  onError: (err: Error) => void;
}

export interface UploadOptions {
  expiresAt: string; // ISO-8601 — sent to server via TUS metadata
}

export function uploadEncrypted(
  data: ArrayBuffer,
  callbacks: UploadCallbacks,
  opts: UploadOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([data], { type: "application/octet-stream" });

    const upload = new Upload(blob, {
      endpoint: "/upload",
      chunkSize: 5 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000],
      // Pass expiry to the server so it enforces the same TTL
      metadata: {
        "expires-at": opts.expiresAt,
      },
      onError(err) {
        callbacks.onError(err instanceof Error ? err : new Error(String(err)));
        reject(err);
      },
      onProgress(uploaded, total) {
        callbacks.onProgress(total > 0 ? uploaded / total : 0);
      },
      onSuccess() {
        const url = upload.url ?? "";
        const id = url.split("/").filter(Boolean).pop() ?? "";
        resolve(id);
      },
    });

    upload.start();
  });
}
