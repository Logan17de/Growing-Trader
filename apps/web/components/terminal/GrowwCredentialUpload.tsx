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
  const [replacing, setReplacing] = useState(false);

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
      setReplacing(false);
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
  const showUploader = !configured || replacing;

  return <div className="settings-stack">
    <div className="notice">
      <Icon name="lock" />
      <div>
        <strong>{configured ? "Encrypted Groww credentials are already saved" : "Upload Groww credentials"}</strong>
        <p>{configured
          ? "Do not upload them again for a daily authorization or permission error. Oracle reuses the saved key and secret; broker authorization is verified separately each morning."
          : "The file is parsed server-side, encrypted immediately, and is never returned by the app."}</p>
      </div>
    </div>

    {configured && !replacing && <button className="secondary" type="button" disabled={disabled || busy} onClick={() => setReplacing(true)}>
      Replace saved credentials
    </button>}

    {showUploader && <>
      <label className="field">
        <span>{configured ? "Replacement Groww credential file (.txt)" : "Groww credential file (.txt)"}</span>
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
      <div className="action-grid">
        <button className="primary" type="button" onClick={() => void upload()} disabled={disabled || busy || !file}>
          {busy ? <><Icon name="refresh" className="spin" />Encrypting &amp; saving…</> : <><Icon name="lock" />{configured ? "Replace credentials" : "Upload &amp; save credentials"}</>}
        </button>
        {configured && <button className="ghost" type="button" disabled={disabled || busy} onClick={() => { setReplacing(false); setFile(null); setNotice(""); if (inputRef.current) inputRef.current.value = ""; }}>Cancel</button>}
      </div>
    </>}

    {notice && <div className={`notice${isError ? " error" : ""}`} role={isError ? "alert" : "status"}>{notice}</div>}
  </div>;
}
