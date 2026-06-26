import React, { useEffect, useRef } from "react";

interface TelegramLoginWidgetProps {
  botName: string;
  onAuth: (user: any) => void;
  buttonSize?: "large" | "medium" | "small";
  cornerRadius?: number;
  requestAccess?: "write" | "read";
  usePic?: boolean;
}

export function TelegramLoginWidget({
  botName,
  onAuth,
  buttonSize = "large",
  cornerRadius = 8,
  requestAccess = "write",
  usePic = true,
}: TelegramLoginWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Set up global callback
    (window as any).onTelegramAuth = onAuth;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botName);
    script.setAttribute("data-size", buttonSize);
    script.setAttribute("data-radius", cornerRadius.toString());
    script.setAttribute("data-request-access", requestAccess);
    script.setAttribute("data-userpic", usePic.toString());
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.async = true;

    containerRef.current.appendChild(script);

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
      delete (window as any).onTelegramAuth;
    };
  }, [botName, buttonSize, cornerRadius, requestAccess, usePic, onAuth]);

  return <div ref={containerRef} />;
}
