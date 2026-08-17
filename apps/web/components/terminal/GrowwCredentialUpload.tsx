"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/terminal/Icon";
import { jsonRequest } from "@/lib/controlClient";

const MAX_FILE_BYTES = 64 * 1024;

type Props = {
  configured: boolean;
  disabled?: boolean;
  onSaved?: () => void | Promise<void>;
};

export function GrowwCredentialUpload({ configured, disabled = false, onSaved }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function upload() {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".txt")) {
      setNotice("Choose a .txt credential file.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setNotice("Credential file is larger than the 64 KB safety limit.");
      return;
    }

    setBusy(true);
    setNotice("");
    try {
      const form = new FormData();
      form.append("credentials", file, file.name);
      await jsonRequest("/api/control/credentials", { method: "POST", body: form });
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setNotice("Groww credential file encrypted and saved. Oracle verification was reset until the next auth test.");
      await onSaved?.();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Credential upload failed");
    } finally {
      setBusy(false);
    }
  }

  const isError = /invalid|missing|unsupported|duplicate|failed|larger|choose|too short|unterminated/i.test(notice);

  return <div className="settings-stack">
    <div className="notice">
      <Icon name="lock" />
      <div>
        <strong>{configured ? "Encrypted Groww credentials are configured" : "Upload Groww credentials"}</strong>
        <p>The file is parsed server-side, encrypted immediately, and is never returned by the app.</p>
      </div>
    </div>
    <label className="field">
      <span>Groww credential file (.txt)</span>
      <input
        ref={inputRef}
        type="file"
        accept=".txt,text/plain"
        disabled={disabled || busy}
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <small>Expected: GROWW_API_KEY='…' and GROWW_API_SECRET='…' on separate lines.</small>
    </label>
    {file && <div className="diagnostic-list settings-detail"><div><span>Selected file</span><strong>{file.name}</strong></div><div><span>Size</span><strong>{Math.max(1, Math.ceil(file.size / 1024))} KB</strong></div></div>}
    <button className="primary" type="button" onClick={() => void upload()} disabled={disabled || busy || !file}>
      {busy ? <><Icon name="refresh" className="spin" />Encrypting &amp; saving…</> : <><Icon name="lock" />Upload &amp; save credentials</>}
    </button>
    {notice && <div className={`notice${isError ? " error" : ""}`} role={isError ? "alert" : "status"}>{notice}</div>}
  </div>;
}
