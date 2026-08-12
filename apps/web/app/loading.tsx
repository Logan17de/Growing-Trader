import { BrandMark } from "@/components/terminal/Icon";

export default function Loading() {
  return <main className="center-shell"><div className="loading-panel" role="status"><BrandMark large /><div><p className="eyebrow">Growing Trader</p><h1>Loading workspace</h1><p className="muted">Preparing the latest authenticated terminal view…</p></div><div className="loading-track" aria-hidden="true"><span /></div></div></main>;
}
