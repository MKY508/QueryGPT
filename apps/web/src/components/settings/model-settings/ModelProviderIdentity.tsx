import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI", anthropic: "Anthropic", deepseek: "DeepSeek", groq: "Groq",
  qwen: "Qwen", orcarouter: "OrcaRouter", ollama: "Ollama",
};

const PROVIDER_MARKS: Record<string, string> = {
  openai: "O", anthropic: "A", deepseek: "D", groq: "G",
  qwen: "Q", orcarouter: "Or", ollama: "Ol", custom: "+",
};

export function ModelProviderName({ provider }: { provider: string }) {
  const t = useTranslations("modelSettings");
  return PROVIDER_NAMES[provider] ?? (provider === "custom" ? t("presetCustom") : provider);
}

export function ModelProviderMark({ provider, selected = false, className }: {
  provider: string; selected?: boolean; className?: string;
}) {
  return <span aria-hidden="true" className={cn(
    "flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/40 font-serif text-lg font-semibold",
    selected ? "border-primary/20 bg-primary text-primary-foreground" : "bg-muted/60 text-foreground/70",
    className,
  )}>{PROVIDER_MARKS[provider] ?? provider.slice(0, 2).toUpperCase()}</span>;
}
