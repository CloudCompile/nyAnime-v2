import React, { useEffect, useState } from "react";
import { WifiOff, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

/**
 * Offline notice only.
 *
 * The previous version replaced `window.fetch` for the whole app and pinged
 * AniList on mount, which this app does not use: it produced "API Connection
 * Issues" toasts for unrelated third parties and reported failures that the
 * user could do nothing about. The browser already tells us when connectivity
 * changes, which is the only signal that leads to a useful action here.
 */
const NetworkStatus = () => {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast({ title: "Back online", description: "Your internet connection has been restored." });
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast({
        title: "Connection lost",
        description: "You are currently offline.",
        variant: "destructive",
      });
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-xs animate-in fade-in slide-in-from-bottom-5">
      <Alert variant="destructive" className="border border-red-500 bg-background/95 shadow-lg backdrop-blur">
        <div className="flex items-center">
          <WifiOff className="mr-2 h-5 w-5" />
          <AlertTitle className="text-sm font-semibold">You&apos;re offline</AlertTitle>
        </div>
        <AlertDescription className="mb-2 mt-1 text-xs">
          Check your internet connection and try again.
        </AlertDescription>
        <Button
          variant="outline"
          size="sm"
          className="mt-1 w-full text-xs"
          onClick={() => window.location.reload()}
        >
          <RefreshCw className="mr-2 h-3 w-3" />
          Reload
        </Button>
      </Alert>
    </div>
  );
};

export default NetworkStatus;
