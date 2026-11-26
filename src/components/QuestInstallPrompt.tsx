import React, { useEffect, useState } from "react";
import { Glasses, X } from "lucide-react";

const DISMISS_KEY = "nyanime.quest-install-dismissed";

/**
 * Quest Browser does not fire `beforeinstallprompt`, so no in-page install
 * button can open the system prompt. The only reliable path is the browser
 * menu, and the only way a visitor discovers it is if the page says so.
 */
const QuestInstallPrompt = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    const xr = navigator.xr;
    if (!xr?.isSessionSupported) return;
    let cancelled = false;
    xr.isSessionSupported("immersive-vr")
      .then((supported) => {
        if (!cancelled && supported) setIsVisible(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <section className="container mx-auto px-4 pt-6 md:px-6">
      <div className="glass-card flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center">
        <Glasses className="h-8 w-8 shrink-0 text-anime-purple" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Watch in the VR theater</p>
          <p className="text-sm text-white/70">
            In the Quest browser, tap the three-dot menu and choose{" "}
            <strong className="text-white">Add page to your library</strong>. Launch NyAnime from
            your library to open the theater.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href="/vr"
            className="rounded-full bg-anime-purple px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-anime-purple/90"
          >
            Open theater
          </a>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss VR install hint"
            className="rounded-full p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
};

export default QuestInstallPrompt;
