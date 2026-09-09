"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ArrowUpRight, Check, FolderOpen, Loader2, Pencil, Plus, RefreshCw, X } from "lucide-react";
import { useProjectStore } from "@/lib/stores/project";
import { useChatStore } from "@/lib/stores/chat";
import { focusableElements, useModalFocus } from "@/lib/use-modal-focus";
import { PROJECT_DIRECTORY_BATCH, PROJECT_NAME_LIMIT, ProjectOperationBusy, searchProjects } from "@/lib/project-directory";
import { getErrorHttpStatus, type Project } from "@/lib/types/api";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/SearchField";

type FormView = "create" | Project | null;

export function ProjectSwitcherDialog({ disabled = false, onClose, onSwitched }: {
  disabled?: boolean; onClose: () => void; onSwitched: () => void;
}) {
  const t = useTranslations("projectSwitcher"), locale = useLocale();
  const { projects, currentProjectId, reloadProjects, createProject, renameProject, selectProject } = useProjectStore();
  const [search, setSearch] = useState(""), [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PROJECT_DIRECTORY_BATCH);
  const [form, setForm] = useState<FormView>(null), [name, setName] = useState("");
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState(false), [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false), [notice, setNotice] = useState<{ key: "created" | "renamed"; name: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), searchInput = useRef<HTMLInputElement>(null), nameInput = useRef<HTMLInputElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>()), renameButtons = useRef(new Map<string, HTMLButtonElement>());
  const createButton = useRef<HTMLButtonElement>(null), formTrigger = useRef<{ id: string } | "create" | null>(null);
  const active = useRef(false), writing = useRef(false), readRequest = useRef<AbortController | null>(null), navigationRevision = useRef(0);
  const disabledRef = useRef(disabled);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  const matches = useMemo(() => searchProjects(projects, currentProjectId, query, locale), [projects, currentProjectId, query, locale]);
  const visible = matches.slice(0, limit);
  const blocked = () => disabledRef.current || !!useChatStore.getState().activeStreamId || useChatStore.getState().isLoading;

  const clearSearch = () => { setSearch(""); setQuery(""); setLimit(PROJECT_DIRECTORY_BATCH); searchInput.current?.focus(); };
  const back = () => { if (!writing.current) { setForm(null); setError(null); setUncertain(false); } };
  const escape = () => {
    if (writing.current) return;
    if (form) back(); else if (search) clearSearch(); else onClose();
  };
  useModalFocus({ active: true, containerRef: dialog, initialFocusRef: searchInput, onClose: escape });
  const load = async () => {
    readRequest.current?.abort();
    const request = new AbortController(); readRequest.current = request;
    setLoading(true); setReadError(false);
    try { await reloadProjects(request.signal); }
    catch { if (active.current && !request.signal.aborted) setReadError(true); }
    finally { if (active.current && !request.signal.aborted) setLoading(false); }
  };
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });
  useEffect(() => {
    active.current = true; const node = dialog.current;
    if (node && !node.open) node.showModal();
    const stopProject = useProjectStore.subscribe((next, previous) => { if (next.currentProjectId !== previous.currentProjectId) navigationRevision.current++; });
    const stopChat = useChatStore.subscribe((next, previous) => { if (next.currentConversationId !== previous.currentConversationId) navigationRevision.current++; });
    void loadRef.current();
    return () => { active.current = false; readRequest.current?.abort(); stopProject(); stopChat(); if (node?.open) node.close(); };
  }, []);
  const previousForm = useRef<FormView>(null);
  useEffect(() => {
    if (form) { nameInput.current?.focus(); nameInput.current?.select(); }
    else if (previousForm.current) {
      const target = formTrigger.current === "create" ? createButton.current : formTrigger.current ? renameButtons.current.get(formTrigger.current.id) : null;
      (target ?? searchInput.current)?.focus();
    }
    previousForm.current = form;
  }, [form]);

  const activate = async (project: Project) => {
    useChatStore.getState().clearConversation({ forget: false });
    await selectProject(project.id);
    if (active.current) onSwitched();
  };
  const choose = async (project: Project) => {
    if (writing.current || blocked() || !useProjectStore.getState().projects.some(item => item.id === project.id)) return;
    if (project.id === useProjectStore.getState().currentProjectId) { onClose(); return; }
    writing.current = true; setBusy(true); setError(null);
    try { await activate(project); }
    catch { if (active.current) setError("openFailed"); }
    finally { writing.current = false; if (active.current) setBusy(false); }
  };
  const begin = (value: Exclude<FormView, null>) => {
    if (writing.current) return;
    formTrigger.current = value === "create" ? "create" : { id: value.id };
    setForm(value); setName(value === "create" ? search.trim().slice(0, PROJECT_NAME_LIMIT) : value.name);
    setError(null); setUncertain(false); setNotice(null);
  };
  const save = async () => {
    if (!form || writing.current || uncertain || (form === "create" && blocked())) return;
    const normalized = name.trim();
    if (!normalized || [...normalized].length > PROJECT_NAME_LIMIT) { setError("nameRequired"); nameInput.current?.focus(); return; }
    if (form !== "create" && normalized === form.name) { back(); return; }
    const origin = navigationRevision.current;
    writing.current = true; setBusy(true); setError(null);
    try {
      if (form === "create") {
        const project = await createProject(normalized, { activate: false });
        if (!active.current) return;
        if (navigationRevision.current === origin && !blocked()) await activate(project);
        else { setForm(null); setNotice({ key: "created", name: project.name }); }
      } else {
        const renamed = await renameProject(form.id, normalized);
        if (active.current) { setForm(null); setNotice({ key: "renamed", name: renamed.name }); }
      }
    } catch (reason) {
      if (!active.current) return;
      const status = getErrorHttpStatus(reason);
      const unclear = !(reason instanceof ProjectOperationBusy) && (!status || status === 404 || status === 408 || status === 409 || status >= 500);
      setUncertain(unclear); setError(reason instanceof ProjectOperationBusy ? "anotherUpdate" : unclear ? "unconfirmed" : "saveFailed");
    } finally { writing.current = false; if (active.current) setBusy(false); }
  };

  return <dialog ref={dialog} aria-label={t("title")} aria-modal="true" onCancel={event => { event.preventDefault(); escape(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if ((event.metaKey || event.ctrlKey) && ["s", "p"].includes(event.key.toLowerCase())) event.preventDefault();
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) escape(); }
      if (event.key === "Tab") {
        const controls = focusableElements(event.currentTarget), first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        event.stopPropagation();
      }
    }} className="report-screen-view fixed inset-0 m-auto hidden h-[min(720px,90vh)] max-h-[90vh] w-[760px] max-w-none flex-col overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/40 open:flex">
    <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border px-5">
      <FolderOpen size={20} className="shrink-0 text-primary" /><h2 className="min-w-0 flex-1 text-base font-semibold">{t("title")}</h2>
      <Button variant="ghost" size="sm" type="button" disabled={busy} aria-label={t("close")} onClick={onClose} className="inline-flex size-9 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-40 h-auto min-h-7 whitespace-normal"><X size={18} /></Button>
    </header>
    {form ? <form onSubmit={event => { event.preventDefault(); void save(); }} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={back} className="mb-7 inline-flex min-h-9 items-center gap-2 text-xs text-muted-foreground disabled:opacity-40 h-auto min-h-7 whitespace-normal"><ArrowLeft size={14} />{t("back")}</Button>
        <h3 className="text-xl font-semibold">{t(form === "create" ? "createTitle" : "renameTitle")}</h3>
        {form !== "create" && <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">{form.name}</p>}
        <label className="mt-8 block text-xs font-semibold">{t("name")}<input ref={nameInput} value={name} maxLength={PROJECT_NAME_LIMIT} disabled={busy}
          onChange={event => { setName(event.target.value); if (!uncertain) setError(null); }}
          onKeyDown={event => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }}
          className="project-switcher-input mt-3 h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:opacity-50" /></label>
        {error && <p role="alert" className="mt-4 text-xs leading-5 text-destructive">{t(error)}</p>}
        {uncertain && <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => { back(); void load(); }} className="mt-3 min-h-9 text-xs text-primary h-auto min-h-7 whitespace-normal">{t("checkList")}</Button>}
      </div>
      <footer className="flex shrink-0 justify-end border-t border-border bg-card px-5 py-4">
        <Button variant="primary" size="sm" type="submit" disabled={busy || uncertain || (form === "create" && disabled)} className="inline-flex min-h-10 items-center gap-2 px-4 text-xs disabled:opacity-40 h-auto min-h-7 whitespace-normal">
          {busy && <Loader2 size={14} className="animate-spin" />}{busy ? t("saving") : t(form === "create" ? "createAndOpen" : "saveName")}</Button>
      </footer>
    </form> : <>
      <div className="shrink-0 border-b border-border px-5 py-4">
        <SearchField inputRef={searchInput} inputClassName="project-switcher-input" label={t("search")} clearLabel={t("clear")} value={search} maxLength={256} disabled={busy}
          onChange={setSearch} onQueryChange={value => { setQuery(value); setLimit(PROJECT_DIRECTORY_BATCH); }}
          onKeyDown={event => { if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && event.key === "ArrowDown") { event.preventDefault(); if (visible[0]) buttons.current.get(visible[0].id)?.focus(); } }} />
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <p role="status">{t("count", { count: matches.length })}</p><Button variant="ghost" size="sm" type="button" disabled={busy || loading} aria-label={t("refresh")} onClick={() => void load()} className="inline-flex size-8 items-center justify-center disabled:opacity-40 h-auto min-h-7 whitespace-normal"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
        {(readError || error) && <p role="alert" className="mx-5 mb-3 border-l-2 border-destructive pl-3 text-xs leading-5 text-destructive">{error ? t(error) : t("readFailed")}</p>}
        {notice && <p role="status" className="mx-5 mb-3 text-xs leading-5 text-primary">{t(notice.key, { name: notice.name })}</p>}
        <ul aria-label={t("list")} className="divide-y divide-border/70">{visible.map((project, index) => <li key={project.id} className="group flex items-center px-2">
          <Button variant="ghost" size="sm" ref={node => { if (node) buttons.current.set(project.id, node); else buttons.current.delete(project.id); }} type="button"
            aria-current={project.id === currentProjectId ? "true" : undefined} aria-disabled={busy || disabled}
            onClick={() => void choose(project)} onKeyDown={event => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault(); const next = visible[index + (event.key === "ArrowDown" ? 1 : -1)];
                if (next) buttons.current.get(next.id)?.focus(); else if (event.key === "ArrowUp") searchInput.current?.focus();
              }
            }} className="flex min-h-20 min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary aria-disabled:opacity-40 h-auto min-h-7 whitespace-normal">
            <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-card text-sm font-semibold text-primary">{[...project.name.trim()][0]}</span>
            <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold">{project.name}</span>{" "}
              {project.description && <span className="mt-1 block line-clamp-2 break-words text-xs leading-5 text-muted-foreground">{project.description}</span>}{" "}
              {project.id === currentProjectId && <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary"><Check size={11} />{t("current")}</span>}
            </span><ArrowUpRight size={14} className="shrink-0 text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="sm" ref={node => { if (node) renameButtons.current.set(project.id, node); else renameButtons.current.delete(project.id); }} type="button" disabled={busy} aria-label={t("rename", { name: project.name })} onClick={() => begin(project)} className="mx-1 inline-flex size-9 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-40 h-auto min-h-7 whitespace-normal"><Pencil size={14} /></Button>
        </li>)}</ul>
        {!visible.length && <div className="px-6 py-12 text-center"><FolderOpen size={28} className="mx-auto mb-4 text-muted-foreground" /><p className="text-sm font-medium">{t(loading ? "loading" : query ? "noMatches" : "empty")}</p></div>}
        {matches.length > limit && <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={event => { const trigger = event.currentTarget, next = matches[limit]?.id; setLimit(value => value + PROJECT_DIRECTORY_BATCH); requestAnimationFrame(() => { if (active.current && next && document.activeElement === trigger) buttons.current.get(next)?.focus(); }); }}
          className="mx-5 my-3 min-h-10 px-3 text-xs text-primary disabled:opacity-40 h-auto min-h-7 whitespace-normal">{t("more")}</Button>}
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-border bg-card px-5 py-4">
        {disabled ? <p className="text-[11px] leading-5 text-muted-foreground">{t("waiting")}</p> : <span />}
        <Button variant="primary" size="sm" ref={createButton} type="button" disabled={busy || disabled} onClick={() => begin("create")} className="inline-flex min-h-10 shrink-0 items-center gap-2 px-3 text-xs disabled:opacity-40 h-auto min-h-7 whitespace-normal"><Plus size={15} />{t("new")}</Button>
      </footer>
    </>}
  </dialog>;
}
