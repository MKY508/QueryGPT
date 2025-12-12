"use client";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check } from "lucide-react";
import { useState } from "react";

interface SqlHighlightProps {
  code: string;
  showCopy?: boolean;
}

export function SqlHighlight({ code, showCopy = true }: SqlHighlightProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      {showCopy && (
        <button
          onClick={handleCopy}
          className="absolute right-2 top-2 p-1.5 bg-secondary hover:bg-muted rounded text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          title="复制代码"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      )}
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
