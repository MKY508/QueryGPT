"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Command } from "cmdk";
import { ArrowUpRight, BookOpenText, Command as CommandIcon, Database, Folders, History, LayoutDashboard, MessageSquarePlus, Plus, Search, Settings, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { focusableElements, hasModalDialog } from "@/lib/use-modal-focus";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

interface WorkbenchCommand {
  id: string; icon: LucideIcon; run: (() => void) | undefined; aliases: string; disabled?: boolean;
}

interface WorkbenchCommandsProps {
  projectName: string;
  busy: boolean;
  onContinue: () => void;
  onNewAnalysis: () => void;
  onOpenHistory: () => void;
  onOpenProjects: () => void;
  onOpenData: () => void;
  onOpenUnderstanding: () => void;
  onOpenReports?: () => void;
  onOpenSettings: () => void;
}

const subscribePlatform = () => () => {};
const macPlatform = () => /Mac/.test(navigator.platform);
const serverPlatform = () => false;
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase().trim();
const shortcut = (event: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) =>
  (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "p";
function canOpenFrom(trigger: HTMLElement | null) {
  if (!trigger?.isConnected || trigger.closest('[inert], [hidden], [aria-hidden="true"]')
    || hasModalDialog()) return false;
  // Next may retain inactive route content instead of disconnecting its nodes.
  for (let node: HTMLElement | null = trigger; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  }
  return true;
}

/** cmdk owns command selection/filtering; the existing native-dialog layer owns
 * modality. Commands only hand off to the workspace's existing user actions. */
export function WorkbenchCommands({ projectName, busy, onContinue, onNewAnalysis, onOpenHistory,
  onOpenProjects, onOpenData, onOpenUnderstanding, onOpenReports, onOpenSettings }: WorkbenchCommandsProps) {
  const t = useTranslations("workbenchCommands");
  const [open, setOpen] = useState(false);
  const isMac = useSyncExternalStore(subscribePlatform, macPlatform, serverPlatform);
  const trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const origin = useRef<HTMLElement | null>(null), choosing = useRef(false), composing = useRef(false);
  const close = () => { dialog.current?.close(); setOpen(false); };
  const groups: { id: string; actions: WorkbenchCommand[] }[] = [
    { id: "investigation", actions: [
      { id: "continue", icon: MessageSquarePlus, run: onContinue, aliases: "继续 提问 question compose continue" },
      { id: "new", icon: Plus, run: onNewAnalysis, aliases: "新建 调查 分析 new analysis investigation", disabled: busy },
    ] },
    { id: "navigate", actions: [
      { id: "data", icon: Database, run: onOpenData, aliases: "数据 文件 连接 导入 project data source file import" },
      { id: "understanding", icon: BookOpenText, run: onOpenUnderstanding, aliases: "项目 理解 口径 定义 project knowledge understanding definition" },
      { id: "history", icon: History, run: onOpenHistory, aliases: "历史 调查 记录 history analysis investigation" },
      { id: "reports", icon: LayoutDashboard, run: onOpenReports, aliases: "报表 文档 project report dashboard document" },
      { id: "projects", icon: Folders, run: onOpenProjects, aliases: "项目 切换 project switch" },
    ] },
    { id: "application", actions: [
      { id: "settings", icon: Settings, run: onOpenSettings, aliases: "设置 模型 服务 外观 settings model appearance preferences" },
    ] },
  ];

  const openMenu = () => {
    if (!canOpenFrom(trigger.current)) return;
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : trigger.current;
    choosing.current = false;
    setOpen(true);
  };
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!shortcut(event) || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (!canOpenFrom(trigger.current)) return;
      event.preventDefault();
      if (!event.repeat) {
        origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : trigger.current;
        choosing.current = false;
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  useEffect(() => {
    if (!open) return;
    const node = dialog.current, opener = trigger.current;
    node?.showModal();
    input.current?.focus();
    return () => {
      node?.close();
      composing.current = false;
      if (choosing.current || hasModalDialog()) return;
      const previous = origin.current;
      // The keyboard opener may have become hidden while the modal was resized.
      if (previous?.isConnected && previous.getClientRects().length && !previous.closest('[inert], [hidden]')) previous.focus({ preventScroll: true });
      else opener?.focus({ preventScroll: true });
    };
  }, [open]);

  return <>
    <Button ref={trigger} variant="outline" type="button" onClick={openMenu} aria-label={t("title")} aria-haspopup="dialog"
      aria-expanded={open} aria-keyshortcuts="Meta+Shift+P Control+Shift+P" title={t("title")}
      className="gap-2 text-xs">
      <CommandIcon size={16} className="text-primary" /><span>{t("title")}</span>
      <kbd aria-hidden="true" className="ml-2 rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{isMac ? "⇧⌘P" : "Ctrl ⇧ P"}</kbd>
    </Button>
    {open && <dialog ref={dialog} aria-label={t("title")} aria-modal="true"
      onCancel={event => { event.preventDefault(); if (!composing.current) close(); }}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDownCapture={event => {
        if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
          if (event.key === "Escape") event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); close(); }
        if (shortcut(event)) { event.preventDefault(); input.current?.focus(); }
        if (event.key === "Tab") {
          const controls = focusableElements(event.currentTarget), first = controls[0], last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}
      className="workbench-command-dialog fixed inset-x-0 bottom-auto top-[10vh] m-auto hidden max-h-[80vh] w-[640px] max-w-none flex-col overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-foreground/30 open:flex">
      <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-muted/40 px-5">
        <CommandIcon size={16} className="text-primary" />
        <h2 className="text-xs font-semibold">{t("title")}</h2>
        <span className="ml-auto max-w-[45%] truncate text-xs text-muted-foreground">{projectName}</span>
        <Button variant="ghost" size="icon" type="button" onClick={close} aria-label={t("close")}><X size={18} /></Button>
      </div>
      <Command label={t("search")} loop vimBindings={false} className="flex min-h-0 flex-1 flex-col"
        filter={(_value, search, keywords = []) => {
          const text = normalize(keywords.join(" "));
          return normalize(search).split(/\s+/).every(word => text.includes(word)) ? 1 : 0;
        }}>
        <div className="workbench-command-search flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
          <Search size={20} className="shrink-0 text-muted-foreground" />
          <Command.Input ref={input} placeholder={t("search")} aria-label={t("search")}
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground" />
        </div>
        <Command.List className="min-h-0 overflow-y-auto overscroll-contain p-2 [scroll-padding-block:8px]">
          <Command.Empty className="px-4 py-10 text-center text-sm text-muted-foreground">{t("empty")}</Command.Empty>
          {groups.map(group => <Command.Group key={group.id} heading={t(group.id)} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-2 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
            {group.actions.filter(action => action.run).map(action => <Command.Item key={action.id} value={action.id}
              keywords={[t(action.id), action.aliases]} disabled={action.disabled}
              onSelect={() => {
                if (choosing.current || action.disabled) return;
                choosing.current = true;
                close();
                action.run?.();
              }}
              className="group flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm data-[disabled=true]:cursor-default data-[disabled=true]:opacity-40 data-[selected=true]:bg-primary/10 data-[selected=true]:text-primary">
              <action.icon size={17} className="shrink-0" />
              <span className="min-w-0 flex-1">{t(action.id)}{action.disabled && <span className="mt-0.5 block text-xs text-muted-foreground">{t("busy")}</span>}</span>
              <ArrowUpRight aria-hidden="true" size={14} className="shrink-0 opacity-0 group-data-[selected=true]:opacity-100" />
            </Command.Item>)}
          </Command.Group>)}
        </Command.List>
      </Command>
      <footer className="flex shrink-0 items-center gap-5 border-t border-border px-5 py-3 text-[11px] text-muted-foreground" aria-hidden="true">
        <span><kbd>↑ ↓</kbd> {t("choose")}</span><span><kbd>↵</kbd> {t("open")}</span><span className="ml-auto"><kbd>Esc</kbd> {t("close")}</span>
      </footer>
    </dialog>}
  </>;
}
