import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import "./drag-preview-window.css";

type PreviewEdge = "top" | "right" | "bottom" | "left";

export function DragPreviewWindowApp() {
  const edge = new URLSearchParams(window.location.search).get("edge") as PreviewEdge | null;
  const [activeEdge, setActiveEdge] = useState<PreviewEdge | null>(null);
  useEffect(() => {
    let dispose: (() => void) | undefined;
    void listen<{ activeEdge: PreviewEdge | null }>("drag-preview-update", ({ payload }) => {
      setActiveEdge(payload.activeEdge);
    }).then((unlisten) => { dispose = unlisten; });
    return () => dispose?.();
  }, []);
  return <div aria-hidden="true" className="drag-preview-stage">
    {edge ? <div className={`drag-preview-target edge-${edge}${activeEdge === edge ? " is-active" : ""}`} /> : null}
  </div>;
}