"use client";

import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import { Copy, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

SyntaxHighlighter.registerLanguage("sql", sql);

interface SqlHighlightProps {
  code: string;
  showCopy?: boolean;
}

export function SqlHighlight({ code, showCopy = true }: SqlHighlightProps) {
  const [copyStatus, setCopyStatus] = useState<{
    code: string;
    state: "copying" | "copied" | "error";
  } | null>(null);
  const copyRequest = useRef(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t = useTranslations("chat");
  const copied = copyStatus?.code === code && copyStatus.state === "copied";
  const copyFailed = copyStatus?.code === code && copyStatus.state === "error";

  useEffect(() => () => {
    copyRequest.current += 1;
    if (resetTimer.current !== null) clearTimeout(resetTimer.current);
  }, []);

  const handleCopy = async () => {
    const request = ++copyRequest.current;
    if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    setCopyStatus({ code, state: "copying" });
    try {
      await navigator.clipboard.writeText(code);
      if (request !== copyRequest.current) return;
      setCopyStatus({ code, state: "copied" });
      resetTimer.current = setTimeout(() => setCopyStatus(null), 2000);
    } catch {
      if (request === copyRequest.current) setCopyStatus({ code, state: "error" });
    }
  };

  return (
    <div className="relative group">
      {showCopy && (
        <button
          type="button"
          onClick={handleCopy}
          disabled={copyStatus?.state === "copying"}
          className="absolute right-2 top-2 p-1.5 bg-secondary hover:bg-muted rounded text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-opacity disabled:cursor-wait"
          title={copied ? t("codeCopied") : t("copyCode")}
          aria-label={copied ? t("codeCopied") : t("copyCode")}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        </button>
      )}
      {showCopy && copyFailed && (
        <p role="alert" className="absolute right-2 top-10 z-10 rounded bg-card px-2 py-1 text-xs text-destructive shadow-sm">
          {t("copyCodeFailed")}
        </p>
      )}
      <span role="status" className="sr-only">{showCopy && copied ? t("codeCopied") : ""}</span>
      <SyntaxHighlighter
        language="sql"
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: "0.5rem",
          fontSize: "0.75rem",
          padding: "0.75rem",
        }}
        wrapLines
        wrapLongLines
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
