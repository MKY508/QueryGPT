"use client";

import { create } from "zustand";
import type { WorkbookSelection } from "@/lib/workbook";
import type { CsvSelection } from "@/lib/csv-import";
import { applySourceReplacement, type ReplacementRequest } from "@/lib/source-replacement";
import { applyRecipeReplay, type RecipeReplayRequest } from "@/lib/recipe-replay";
import { runtimeMessage } from "@/i18n/runtime";
import { inspectProject, inspectProjectDirectory, ProjectOperationBusy, PROJECT_NAME_LIMIT } from "@/lib/project-directory";
import { api } from "@/lib/api/client";
import { FileUploadQueue } from "@/lib/file-upload-queue";
import { resolveFileUpload } from "@/lib/file-upload";
import { listPendingUploads, subscribeUploadJournal, uploadJournal } from "@/lib/upload-journal";
import { useUploadQueueStore } from "@/lib/stores/uploads";
import {
  migrateProjectStorage,
  PROJECT_STORAGE_KEY,
} from "@/lib/storage/legacy";
import {
  getErrorHttpStatus,
  getUserFacingErrorMessage,
  UserFacingError,
} from "@/lib/types/api";
import type {
  PreflightReport,
  Project,
  ProjectDataSource,
  SanitationRecipe,
  SanitationRecipeRevision,
  SanitationTemplatePreview,
  SanitationTemplateSummary,
  SemanticEntry,
  SemanticEntryRevision,
  VisualCleaningApplyResult,
  VisualCleaningOperation,
  VisualCleaningPreview,
} from "@/lib/types/api";

let refreshGeneration = 0;
let projectDirectoryGeneration = 0, projectNavigationGeneration = 0;
let creatingProject = false;
const renamingProjects = new Set<string>();
const sourceReplacements = new Set<string>();
const recipeReplays = new Set<string>();
const cleaningApplications = new Set<string>();
// Project-owned operations survive navigation; they must not own another
// project's busy state or submit a duplicate from an overlapping drop/click.
const sourceAdditions = new Set<string>();

interface ProjectBootstrapDefaults {
  name: string;
  description: string;
}

export function storedProjectId(storage?: Storage): string | null {
  try {
    return migrateProjectStorage(storage || window.localStorage);
  } catch {
    return null;
  }
}

interface ProjectState {
  projects: Project[];
  currentProjectId: string | null;
  sources: ProjectDataSource[];
  preflightReports: PreflightReport[];
  recipes: SanitationRecipe[];
  recipeRevisionsByRecipe: Record<string, SanitationRecipeRevision[]>;
  recipeRevisionLoadingByRecipe: Record<string, boolean>;
  recipeRevisionRestoringByRecipe: Record<string, string | null>;
  recipeRevisionErrorByRecipe: Record<string, string | null>;
  recipeTemplates: SanitationTemplateSummary[];
  recipeTemplatePreviewById: Record<string, SanitationTemplatePreview | undefined>;
  recipeTemplateAction: {
    templateId: string;
    kind: "preview" | "bind";
  } | null;
  cleaningPreviewBySource: Record<string, VisualCleaningPreview | undefined>;
  cleaningAction: {
    sourceId: string;
    kind: "preview" | "apply";
  } | null;
  knowledge: SemanticEntry[];
  knowledgeTotal: number;
  pendingKnowledgeCount: number;
  relationshipKnowledgeCount: number;
  knowledgeRevisionsByEntry: Record<string, SemanticEntryRevision[]>;
  knowledgeRevisionLoadingByEntry: Record<string, boolean>;
  knowledgeRevisionRestoringByEntry: Record<string, string | null>;
  knowledgeRevisionErrorByEntry: Record<string, string | null>;
  suggestedQuestionsRevisionByProject: Record<string, number>;
  isBootstrapping: boolean;
  isUploading: boolean;
  isUpdatingKnowledge: boolean;
  sourceAction: {
    sourceId: string;
    kind: "profile" | "reorganize" | "accept_replacement" | "keep_trusted" | "remove" | "replace";
  } | null;
  error: string | null;
  bootstrap: (defaults: ProjectBootstrapDefaults) => Promise<void>;
  reloadProjects: (signal?: AbortSignal) => Promise<void>;
  createProject: (name: string, options?: { activate?: boolean }) => Promise<Project>;
  renameProject: (id: string, name: string) => Promise<Project>;
  selectProject: (id: string) => Promise<void>;
  refreshCurrent: (options?: { throwOnError?: boolean }) => Promise<void>;
  loadRecipeRevisions: (id: string) => Promise<SanitationRecipeRevision[]>;
  replayRecipe: (projectId: string, sourceId: string, recipeId: string, request: RecipeReplayRequest & { proof: string }) => Promise<void>;
  restoreRecipeRevision: (
    id: string,
    revisionId: string
  ) => Promise<SanitationRecipeRevision>;
  previewRecipeTemplate: (
    templateId: string,
    sourceId: string
  ) => Promise<SanitationTemplatePreview>;
  bindRecipeTemplate: (templateId: string) => Promise<void>;
  previewSourceCleaning: (
    sourceId: string,
    operations: VisualCleaningOperation[]
  ) => Promise<VisualCleaningPreview>;
  clearSourceCleaningPreview: (sourceId: string) => void;
  applySourceCleaning: (
    sourceId: string,
    operations: VisualCleaningOperation[]
  ) => Promise<VisualCleaningApplyResult>;
  loadKnowledgeRevisions: (id: string) => Promise<SemanticEntryRevision[]>;
  restoreKnowledgeRevision: (id: string, revisionId: string) => Promise<SemanticEntry>;
  updateKnowledge: (
    id: string,
    changes: Partial<
      Pick<
        SemanticEntry,
        | "value"
        | "state"
        | "confidence"
        | "definition"
        | "validity"
        | "evidence"
        | "source"
      >
    >
  ) => Promise<SemanticEntry>;
  createKnowledge: (
    entry: Pick<
      SemanticEntry,
      | "key"
      | "value"
      | "entry_type"
      | "state"
      | "confidence"
      | "validity"
      | "evidence"
      | "source"
    >
  ) => Promise<SemanticEntry>;
  uploadFile: (file: File) => Promise<void>;
  uploadFiles: (files: readonly File[]) => Promise<void>;
  checkUpload: (itemId: string, projectId?: string) => Promise<void>;
  reselectUpload: (itemId: string, file: File, projectId: string) => Promise<void>;
  resumeUploads: (projectId?: string) => Promise<void>;
  pauseUploads: (projectId?: string) => void;
  retryUpload: (id: string, projectId?: string) => Promise<void>;
  cancelQueuedUpload: (id: string, projectId?: string) => void;
  cancelQueuedUploads: (projectId?: string) => void;
  clearUploads: (projectId?: string) => void;
  attachConnection: (connectionId: string, name?: string) => Promise<void>;
  profileSource: (sourceId: string, selection?: WorkbookSelection | CsvSelection) => Promise<void>;
  reorganizeSource: (sourceId: string) => Promise<void>;
  acceptReplacement: (sourceId: string) => Promise<void>;
  replaceSource: (projectId: string, sourceId: string, request: ReplacementRequest & { proof: string }) => Promise<void>;
  keepTrustedSource: (sourceId: string) => Promise<void>;
  removeSource: (sourceId: string) => Promise<void>;
}

function messageFrom(error: unknown): string {
  return getUserFacingErrorMessage(error, runtimeMessage("dataPreparationFailed"));
}

interface SemanticKnowledgeSummary {
  active_total: number;
  pending_total: number;
  relationship_total: number;
  confirmed_total: number;
  locked_total: number;
}

interface SemanticKnowledgePreview {
  items: SemanticEntry[];
  summary: SemanticKnowledgeSummary;
}

const KNOWLEDGE_PREVIEW_LIMIT = 100;

function isUserVisibleKnowledge(entry: SemanticEntry): boolean {
  if (entry.entry_type === "verified_query") return false;
  return !(
    entry.entry_type === "cleaning_rule" && /^[\[{]/.test(entry.value.trim())
  );
}

async function fetchKnowledgePreview(projectId: string): Promise<SemanticKnowledgePreview> {
  const [summaryResponse, pageResponse] = await Promise.all([
    api.get(`/api/v1/projects/${projectId}/knowledge/summary`),
    api.get(`/api/v1/projects/${projectId}/knowledge/page`, {
      params: {
        offset: 0,
        limit: KNOWLEDGE_PREVIEW_LIMIT,
        business_facing_only: true,
      },
    }),
  ]);
  return {
    items: (pageResponse.data.data.items || []) as SemanticEntry[],
    summary: summaryResponse.data.data as SemanticKnowledgeSummary,
  };
}

async function fetchKnowledgeRestoreState(
  projectId: string,
  entryId: string,
  options: { includeEntry: boolean }
) {
  const [previewResult, revisionsResult, entryResult] = await Promise.allSettled([
    fetchKnowledgePreview(projectId),
    api.get(`/api/v1/projects/${projectId}/knowledge/${entryId}/revisions`),
    options.includeEntry
      ? api.get(`/api/v1/projects/${projectId}/knowledge/${entryId}`)
      : Promise.resolve(null),
  ]);
  return {
    preview:
      previewResult.status === "fulfilled" ? previewResult.value : null,
    revisions:
      revisionsResult.status === "fulfilled"
        ? (revisionsResult.value.data.data as SemanticEntryRevision[])
        : null,
    entry:
      options.includeEntry &&
      entryResult.status === "fulfilled" &&
      entryResult.value
        ? (entryResult.value.data.data as SemanticEntry)
        : null,
  };
}

function semanticCountContribution(entry: SemanticEntry | undefined) {
  const active = Boolean(entry && entry.is_active !== false);
  return {
    total: active ? 1 : 0,
    pending:
      active &&
      entry &&
      isUserVisibleKnowledge(entry) &&
      entry.state === "candidate" &&
      entry.validity !== "stale"
        ? 1
        : 0,
    relationship: active && entry?.entry_type === "relationship" ? 1 : 0,
  };
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProjectId: null,
  sources: [],
  preflightReports: [],
  recipes: [],
  recipeRevisionsByRecipe: {},
  recipeRevisionLoadingByRecipe: {},
  recipeRevisionRestoringByRecipe: {},
  recipeRevisionErrorByRecipe: {},
  recipeTemplates: [],
  recipeTemplatePreviewById: {},
  recipeTemplateAction: null,
  cleaningPreviewBySource: {},
  cleaningAction: null,
  knowledge: [],
  knowledgeTotal: 0,
  pendingKnowledgeCount: 0,
  relationshipKnowledgeCount: 0,
  knowledgeRevisionsByEntry: {},
  knowledgeRevisionLoadingByEntry: {},
  knowledgeRevisionRestoringByEntry: {},
  knowledgeRevisionErrorByEntry: {},
  suggestedQuestionsRevisionByProject: {},
  isBootstrapping: false,
  isUploading: false,
  isUpdatingKnowledge: false,
  sourceAction: null,
  error: null,

  bootstrap: async (defaults) => {
    if (get().isBootstrapping) return;
    set({ isBootstrapping: true, error: null });
    try {
      const response = await api.get("/api/v1/projects");
      let projects = response.data.data as Project[];
      if (!projects.length) {
        const created = await api.post("/api/v1/projects", {
          name: defaults.name,
          description: defaults.description,
        });
        projects = [created.data.data as Project];
      }
      const saved = storedProjectId();
      const currentProjectId =
        projects.find((project) => project.id === saved)?.id || projects[0].id;
      localStorage.setItem(PROJECT_STORAGE_KEY, currentProjectId);
      projectDirectoryGeneration++;
      set({ projects, currentProjectId });
      await get().refreshCurrent();
    } catch (error) {
      set({ error: messageFrom(error) });
    } finally {
      set({ isBootstrapping: false });
    }
  },

  reloadProjects: async (signal) => {
    const generation = ++projectDirectoryGeneration;
    const response = await api.get("/api/v1/projects", { signal });
    const projects = inspectProjectDirectory(response.data.data);
    if (!signal?.aborted && generation === projectDirectoryGeneration) set({ projects });
  },

  createProject: async (name, options) => {
    const normalized = name.trim();
    if (!normalized || [...normalized].length > PROJECT_NAME_LIMIT) throw new Error("Invalid project name");
    if (creatingProject) throw new ProjectOperationBusy();
    creatingProject = true; projectDirectoryGeneration++;
    const origin = get().currentProjectId, navigation = projectNavigationGeneration;
    try {
      const response = await api.post("/api/v1/projects", { name: normalized });
      const project = inspectProject(response.data.data, { name: normalized });
      if (get().projects.some(item => item.id === project.id)) throw new Error("Creation returned an existing project");
      projectDirectoryGeneration++;
      set((state) => ({ projects: [project, ...state.projects] }));
      if (options?.activate !== false && get().currentProjectId === origin && navigation === projectNavigationGeneration) await get().selectProject(project.id);
      return project;
    } finally { creatingProject = false; }
  },

  renameProject: async (id, name) => {
    const normalized = name.trim();
    if (!normalized || [...normalized].length > PROJECT_NAME_LIMIT) throw new Error("Invalid project name");
    if (renamingProjects.has(id)) throw new ProjectOperationBusy();
    renamingProjects.add(id); projectDirectoryGeneration++;
    try {
      const response = await api.patch(`/api/v1/projects/${id}`, { name: normalized });
      const project = inspectProject(response.data.data, { id, name: normalized });
      projectDirectoryGeneration++;
      set((state) => ({ projects: state.projects.map((item) => (item.id === id ? project : item)) }));
      return project;
    } finally { renamingProjects.delete(id); }
  },

  selectProject: async (id) => {
    projectNavigationGeneration++;
    // Remembering a choice is optional; blocked browser storage must not turn
    // a deliberate switch into a failed operation after the old chat closes.
    try { localStorage.setItem(PROJECT_STORAGE_KEY, id); } catch { /* session-only choice */ }
    set({
      currentProjectId: id,
      isUploading: sourceAdditions.has(id),
      sources: [],
      preflightReports: [],
      recipes: [],
      recipeRevisionsByRecipe: {},
      recipeRevisionLoadingByRecipe: {},
      recipeRevisionRestoringByRecipe: {},
      recipeRevisionErrorByRecipe: {},
      recipeTemplates: [],
      recipeTemplatePreviewById: {},
      recipeTemplateAction: null,
      cleaningPreviewBySource: {},
      cleaningAction: null,
      knowledge: [],
      knowledgeTotal: 0,
      pendingKnowledgeCount: 0,
      relationshipKnowledgeCount: 0,
      knowledgeRevisionsByEntry: {},
      knowledgeRevisionLoadingByEntry: {},
      knowledgeRevisionRestoringByEntry: {},
      knowledgeRevisionErrorByEntry: {},
      sourceAction: null,
      error: null,
    });
    await get().refreshCurrent();
  },

  refreshCurrent: async (options) => {
    const projectId = get().currentProjectId;
    if (!projectId) return;
    const generation = ++refreshGeneration;
    try {
      const [
        sourcesResponse,
        reportsResponse,
        knowledgePreview,
        recipesResponse,
        templatesResponse,
      ] =
        await Promise.all([
        api.get(`/api/v1/projects/${projectId}/sources`),
        api.get(`/api/v1/projects/${projectId}/preflight`),
        fetchKnowledgePreview(projectId),
        Promise.resolve()
          .then(() => api.get(`/api/v1/projects/${projectId}/recipes`))
          .catch(() => null),
        Promise.resolve()
          .then(() => api.get(`/api/v1/projects/${projectId}/recipe-templates`))
          .catch(() => null),
      ]);
      if (
        get().currentProjectId !== projectId ||
        generation !== refreshGeneration
      ) {
        return;
      }
      set((state) => ({
        sources: sourcesResponse.data.data as ProjectDataSource[],
        preflightReports: reportsResponse.data.data as PreflightReport[],
        recipes:
          (recipesResponse?.data?.data as SanitationRecipe[] | undefined) ||
          get().recipes,
        recipeTemplates:
          (templatesResponse?.data?.data as SanitationTemplateSummary[] | undefined) ||
          get().recipeTemplates,
        knowledge: knowledgePreview.items,
        knowledgeTotal: knowledgePreview.summary.active_total,
        pendingKnowledgeCount: knowledgePreview.summary.pending_total,
        relationshipKnowledgeCount: knowledgePreview.summary.relationship_total,
        // Semantic workspace writes also refresh here without using the store's
        // individual knowledge actions. Retire the old suggestion snapshot;
        // this revision never triggers generation by itself.
        suggestedQuestionsRevisionByProject: {
          ...state.suggestedQuestionsRevisionByProject,
          [projectId]: (state.suggestedQuestionsRevisionByProject[projectId] || 0) + 1,
        },
        error: null,
      }));
    } catch (error) {
      if (
        get().currentProjectId === projectId &&
        generation === refreshGeneration
      ) {
        set({ error: messageFrom(error) });
        if (options?.throwOnError) throw error;
      }
    }
  },

  loadRecipeRevisions: async (id) => {
    const projectId = get().currentProjectId;
    if (!projectId) throw new UserFacingError(runtimeMessage("noProjectToView"));
    const cached = get().recipeRevisionsByRecipe[id];
    if (cached) return cached;
    if (get().recipeRevisionLoadingByRecipe[id]) return [];

    set((state) => ({
      recipeRevisionLoadingByRecipe: {
        ...state.recipeRevisionLoadingByRecipe,
        [id]: true,
      },
      recipeRevisionErrorByRecipe: {
        ...state.recipeRevisionErrorByRecipe,
        [id]: null,
      },
    }));
    try {
      const response = await api.get(
        `/api/v1/projects/${projectId}/recipes/${id}/revisions`
      );
      const revisions = response.data.data as SanitationRecipeRevision[];
      if (get().currentProjectId === projectId) {
        set((state) => ({
          recipeRevisionsByRecipe: {
            ...state.recipeRevisionsByRecipe,
            [id]: revisions,
          },
        }));
      }
      return revisions;
    } catch (error) {
      if (get().currentProjectId === projectId) {
        set((state) => ({
          recipeRevisionErrorByRecipe: {
            ...state.recipeRevisionErrorByRecipe,
            [id]: runtimeMessage("recipeHistoryLoadFailed"),
          },
        }));
      }
      throw error;
    } finally {
      if (get().currentProjectId === projectId) {
        set((state) => ({
          recipeRevisionLoadingByRecipe: {
            ...state.recipeRevisionLoadingByRecipe,
            [id]: false,
          },
        }));
      }
    }
  },

  restoreRecipeRevision: async (id, revisionId) => {
    const projectId = get().currentProjectId;
    if (!projectId) throw new UserFacingError(runtimeMessage("noProjectToUpdate"));
    const recipe = get().recipes.find((item) => item.id === id);
    if (!recipe?.active_revision_id) {
      throw new UserFacingError(runtimeMessage("recipeHistoryNotReady"));
    }
    set((state) => ({
      recipeRevisionRestoringByRecipe: {
        ...state.recipeRevisionRestoringByRecipe,
        [id]: revisionId,
      },
      recipeRevisionErrorByRecipe: {
        ...state.recipeRevisionErrorByRecipe,
        [id]: null,
      },
    }));
    try {
      const response = await api.post(
        `/api/v1/projects/${projectId}/recipes/${id}/revisions/${revisionId}/restore`,
        { expected_active_revision_id: recipe.active_revision_id }
      );
      const restored = response.data.data as SanitationRecipeRevision;
      const [recipesResponse, revisionsResponse] = await Promise.all([
        api.get(`/api/v1/projects/${projectId}/recipes`),
        api.get(`/api/v1/projects/${projectId}/recipes/${id}/revisions`),
      ]);
      if (get().currentProjectId === projectId) {
        set((state) => ({
          recipes: recipesResponse.data.data as SanitationRecipe[],
          recipeRevisionsByRecipe: {
            ...state.recipeRevisionsByRecipe,
            [id]: revisionsResponse.data.data as SanitationRecipeRevision[],
          },
        }));
      }
      return restored;
    } catch (error) {
      const status = getErrorHttpStatus(error);
      const message =
        status === 409
          ? runtimeMessage("recipeChangedBeforeRestore")
          : status === 404
            ? runtimeMessage("recipeRevisionUnavailable")
            : runtimeMessage("recipeRestoreFailed");
      if (get().currentProjectId === projectId) {
        set((state) => ({
          recipeRevisionErrorByRecipe: {
            ...state.recipeRevisionErrorByRecipe,
            [id]: message,
          },
        }));
      }
      throw new UserFacingError(message);
    } finally {
      if (get().currentProjectId === projectId) {
        set((state) => ({
          recipeRevisionRestoringByRecipe: {
            ...state.recipeRevisionRestoringByRecipe,
            [id]: null,
          },
        }));
      }
    }
  },

  previewRecipeTemplate: async (templateId, sourceId) => {
    const projectId = get().currentProjectId;
    if (!projectId) throw new UserFacingError(runtimeMessage("noProjectToClean"));
    set({
      recipeTemplateAction: { templateId, kind: "preview" },
      error: null,
    });
    try {
      const response = await api.post(
        `/api/v1/projects/${projectId}/recipe-templates/${templateId}/preview`,
        { source_id: sourceId },
        { timeout: 120000 }
      );
      const preview = response.data.data as SanitationTemplatePreview;
      if (get().currentProjectId === projectId) {
        set((state) => ({
          recipeTemplatePreviewById: {
            ...state.recipeTemplatePreviewById,
            [templateId]: preview,
          },
        }));
      }
      return preview;
    } catch (error) {
      if (get().currentProjectId === projectId) set({ error: messageFrom(error) });
      throw error;
    } finally {
      if (
        get().currentProjectId === projectId &&
        get().recipeTemplateAction?.templateId === templateId
      ) {
        set({ recipeTemplateAction: null });
      }
    }
  },

  bindRecipeTemplate: async (templateId) => {
    const projectId = get().currentProjectId;
    const preview = get().recipeTemplatePreviewById[templateId];
    if (!projectId || !preview) {
      throw new UserFacingError(runtimeMessage("previewRecipeFirst"));
    }
    set({
      recipeTemplateAction: { templateId, kind: "bind" },
      error: null,
    });
    try {
      await api.post(
        `/api/v1/projects/${projectId}/recipe-templates/${templateId}/bind`,
        {
          source_id: preview.source_id,
          expected_template_active_revision_id:
            preview.template_active_revision_id,
          expected_template_operations_hash: preview.template_operations_hash,
          expected_source_fingerprint: preview.source_fingerprint,
          expected_preview_output_fingerprint:
            preview.preview_output_fingerprint,
          expected_current_working_fingerprint:
            preview.current_working_fingerprint ?? null,
          expected_current_recipe_active_revision_id:
            preview.current_recipe_active_revision_id ?? null,
        },
        { timeout: 120000 }
      );
      if (get().currentProjectId === projectId) {
        set((state) => ({
          recipeTemplatePreviewById: Object.fromEntries(
            Object.entries(state.recipeTemplatePreviewById).filter(
              ([id]) => id !== templateId
            )
          ),
        }));
        await get().refreshCurrent();
      }
    } catch (error) {
      if (get().currentProjectId === projectId) set({ error: messageFrom(error) });
      throw error;
    } finally {
      if (
        get().currentProjectId === projectId &&
        get().recipeTemplateAction?.templateId === templateId
      ) {
        set({ recipeTemplateAction: null });
      }
    }
  },

  previewSourceCleaning: async (sourceId, operations) => {
    const projectId = get().currentProjectId;
    if (!projectId) throw new UserFacingError(runtimeMessage("noProjectToClean"));
    if (get().cleaningAction || cleaningApplications.has(JSON.stringify([projectId, sourceId]))) {
      throw new UserFacingError(runtimeMessage("cleaningInProgress"));
    }
    const action = { sourceId, kind: "preview" as const };
    const ownsRequest = () => get().currentProjectId === projectId && get().cleaningAction === action;
    get().clearSourceCleaningPreview(sourceId);
    set({
      cleaningAction: action,
      error: null,
    });
    try {
      const response = await api.post(
        `/api/v1/projects/${projectId}/sources/${sourceId}/cleaning/preview`,
        { operations },
        { timeout: 120000 }
      );
      const preview = response.data.data as VisualCleaningPreview;
      if (
        ownsRequest() &&
        preview.source_id === sourceId
      ) {
        set((state) => ({
          cleaningPreviewBySource: {
            ...state.cleaningPreviewBySource,
            [sourceId]: preview,
          },
        }));
      }
      return preview;
    } catch (error) {
      if (ownsRequest()) {
        set({ error: runtimeMessage("cleaningPreviewFailed") });
      }
      throw error;
    } finally {
      if (ownsRequest()) {
        set({ cleaningAction: null });
      }
    }
  },

  clearSourceCleaningPreview: (sourceId) => {
    set((state) => ({
      // Closing/editing invalidates a pending preview as well as its result.
      // An apply is a committed-write attempt and cannot be cancelled this way.
      cleaningAction: state.cleaningAction?.sourceId === sourceId && state.cleaningAction.kind === "preview"
        ? null : state.cleaningAction,
      cleaningPreviewBySource: Object.fromEntries(
        Object.entries(state.cleaningPreviewBySource).filter(
          ([id]) => id !== sourceId
        )
      ),
    }));
  },

  applySourceCleaning: async (sourceId, operations) => {
    const projectId = get().currentProjectId;
    const preview = get().cleaningPreviewBySource[sourceId];
    if (!projectId || !preview || !preview.can_apply) {
      throw new UserFacingError(runtimeMessage("previewCleaningFirst"));
    }
    const applicationKey = JSON.stringify([projectId, sourceId]);
    if (get().cleaningAction || cleaningApplications.has(applicationKey)) {
      throw new UserFacingError(runtimeMessage("cleaningInProgress"));
    }
    cleaningApplications.add(applicationKey);
    const action = { sourceId, kind: "apply" as const };
    const ownsRequest = () => get().currentProjectId === projectId && get().cleaningAction === action;
    set({
      cleaningAction: action,
      error: null,
    });
    try {
      let result: VisualCleaningApplyResult;
      try {
        const response = await api.post(
          `/api/v1/projects/${projectId}/sources/${sourceId}/cleaning/apply`,
          {
            operations,
            expected_operations_hash: preview.operations_hash,
            expected_source_fingerprint: preview.source_fingerprint,
            expected_preview_output_fingerprint:
              preview.preview_output_fingerprint,
            expected_current_working_fingerprint:
              preview.current_working_fingerprint ?? null,
            expected_current_recipe_active_revision_id:
              preview.current_recipe_active_revision_id ?? null,
          },
          { timeout: 120000 }
        );
        result = response.data.data as VisualCleaningApplyResult;
      } catch (error) {
        if (ownsRequest()) {
          if (getErrorHttpStatus(error) === 409 || getErrorHttpStatus(error) === 422) {
            get().clearSourceCleaningPreview(sourceId);
          }
          set({
            error:
              getErrorHttpStatus(error) === 409 || getErrorHttpStatus(error) === 422
                ? runtimeMessage("sourceChangedBeforeApply")
                : runtimeMessage("cleaningApplyFailed"),
          });
        }
        throw error;
      }

      if (ownsRequest()) {
        get().clearSourceCleaningPreview(sourceId);
        try {
          await get().refreshCurrent();
        } catch {
          // The mutation is already committed. A follow-up refresh is useful
          // but must never turn a successful apply into a failed apply.
        }
        if (ownsRequest()) set({ error: null });
      }
      return result;
    } finally {
      cleaningApplications.delete(applicationKey);
      if (ownsRequest()) {
        set({ cleaningAction: null });
      }
    }
  },

  loadKnowledgeRevisions: async (id) => {
    const projectId = get().currentProjectId;
    if (!projectId) throw new UserFacingError(runtimeMessage("noProjectToView"));
    const cached = get().knowledgeRevisionsByEntry[id];
    if (cached) return cached;
    if (get().knowledgeRevisionLoadingByEntry[id]) return [];

    set((state) => ({
      knowledgeRevisionLoadingByEntry: {
        ...state.knowledgeRevisionLoadingByEntry,
        [id]: true,
      },
      knowledgeRevisionErrorByEntry: {
        ...state.knowledgeRevisionErrorByEntry,
        [id]: null,
      },
    }));
    try {
      const response = await api.get(
        `/api/v1/projects/${projectId}/knowledge/${id}/revisions`
      );
      const revisions = response.data.data as SemanticEntryRevision[];
      if (get().currentProjectId === projectId) {
        set((state) => ({
          knowledgeRevisionsByEntry: {
            ...state.knowledgeRevisionsByEntry,
            [id]: revisions,
          },
        }));
      }
      return revisions;
    } catch (error) {
      if (get().currentProjectId === projectId) {
        set((state) => ({
          knowledgeRevisionErrorByEntry: {
            ...state.knowledgeRevisionErrorByEntry,
            [id]: runtimeMessage("revisionHistoryLoadFailed"),
          },
        }));
      }
      throw error;
    } finally {
      if (get().currentProjectId === projectId) {
        set((state) => ({
          knowledgeRevisionLoadingByEntry: {
            ...state.knowledgeRevisionLoadingByEntry,
            [id]: false,
          },
        }));
      }
    }
  },

  restoreKnowledgeRevision: async (id, revisionId) => {
    const projectId = get().currentProjectId;
    if (!projectId) throw new UserFacingError(runtimeMessage("noProjectToUpdate"));
    const entry = get().knowledge.find((item) => item.id === id);
    const expectedActiveRevisionId = entry?.active_revision_id;
    if (!expectedActiveRevisionId) {
      const message = runtimeMessage("understandingRevisionNotReady");
      set((state) => ({
        knowledgeRevisionErrorByEntry: {
          ...state.knowledgeRevisionErrorByEntry,
          [id]: message,
        },
      }));
      throw new UserFacingError(message);
    }

    set((state) => ({
      knowledgeRevisionRestoringByEntry: {
        ...state.knowledgeRevisionRestoringByEntry,
        [id]: revisionId,
      },
      knowledgeRevisionErrorByEntry: {
        ...state.knowledgeRevisionErrorByEntry,
        [id]: null,
      },
    }));
    try {
      const response = await api.post(
        `/api/v1/projects/${projectId}/knowledge/${id}/revisions/${revisionId}/restore`,
        { expected_active_revision_id: expectedActiveRevisionId }
      );
      const restored = response.data.data as SemanticEntry;
      const refreshed = await fetchKnowledgeRestoreState(projectId, id, {
        includeEntry: false,
      });
      if (get().currentProjectId === projectId) {
        set((state) => {
          const previous = state.knowledge.find((item) => item.id === id);
          const before = semanticCountContribution(previous);
          const after = semanticCountContribution(restored);
          return {
            knowledge:
              refreshed.preview?.items ||
              state.knowledge.map((item) => (item.id === id ? restored : item)),
            knowledgeTotal:
              refreshed.preview?.summary.active_total ??
              state.knowledgeTotal + after.total - before.total,
            pendingKnowledgeCount:
              refreshed.preview?.summary.pending_total ??
              state.pendingKnowledgeCount + after.pending - before.pending,
            relationshipKnowledgeCount:
              refreshed.preview?.summary.relationship_total ??
              state.relationshipKnowledgeCount + after.relationship - before.relationship,
            knowledgeRevisionsByEntry: refreshed.revisions
              ? { ...state.knowledgeRevisionsByEntry, [id]: refreshed.revisions }
              : state.knowledgeRevisionsByEntry,
            knowledgeRevisionErrorByEntry: {
              ...state.knowledgeRevisionErrorByEntry,
              [id]: null,
            },
            suggestedQuestionsRevisionByProject: {
              ...state.suggestedQuestionsRevisionByProject,
              [projectId]: (state.suggestedQuestionsRevisionByProject[projectId] || 0) + 1,
            },
          };
        });
      }
      return restored;
    } catch (error) {
      const status = getErrorHttpStatus(error);
      const refreshed =
        status === 409 || status === 404
          ? await fetchKnowledgeRestoreState(projectId, id, { includeEntry: true })
          : { preview: null, revisions: null, entry: null };
      const refreshCompleted = Boolean(
        (refreshed.preview || refreshed.entry) && refreshed.revisions
      );
      const message =
        status === 409
          ? refreshCompleted
            ? runtimeMessage("understandingChangedRefreshThenRestore")
            : runtimeMessage("understandingChangedBeforeRestore")
          : status === 404
            ? refreshCompleted
              ? runtimeMessage("understandingRevisionUnavailableRefreshed")
              : runtimeMessage("understandingRevisionUnavailable")
            : runtimeMessage("understandingRestoreFailed");
      if (get().currentProjectId === projectId) {
        set((state) => {
          const fallbackKnowledge = refreshed.entry
            ? state.knowledge.map((item) =>
                item.id === id ? refreshed.entry as SemanticEntry : item
              )
            : state.knowledge;
          return {
            knowledge: refreshed.preview?.items || fallbackKnowledge,
            knowledgeTotal:
              refreshed.preview?.summary.active_total ?? state.knowledgeTotal,
            pendingKnowledgeCount:
              refreshed.preview?.summary.pending_total ?? state.pendingKnowledgeCount,
            relationshipKnowledgeCount:
              refreshed.preview?.summary.relationship_total ??
              state.relationshipKnowledgeCount,
            knowledgeRevisionsByEntry: refreshed.revisions
              ? { ...state.knowledgeRevisionsByEntry, [id]: refreshed.revisions }
              : state.knowledgeRevisionsByEntry,
            knowledgeRevisionErrorByEntry: {
              ...state.knowledgeRevisionErrorByEntry,
              [id]: message,
            },
          };
        });
      }
      throw new UserFacingError(message);
    } finally {
      if (get().currentProjectId === projectId) {
        set((state) => ({
          knowledgeRevisionRestoringByEntry: {
            ...state.knowledgeRevisionRestoringByEntry,
            [id]: null,
          },
        }));
      }
    }
  },

  updateKnowledge: async (id, changes) => {
    const projectId = get().currentProjectId;
    if (!projectId) throw new UserFacingError(runtimeMessage("noProjectToUpdate"));
    const activeRevisionId = get().knowledge.find((item) => item.id === id)?.active_revision_id;
    set({ isUpdatingKnowledge: true, error: null });
    try {
      const response = await api.put(`/api/v1/projects/${projectId}/knowledge/${id}`, {
        ...changes,
        ...(activeRevisionId ? { expected_active_revision_id: activeRevisionId } : {}),
      });
      const entry = response.data.data as SemanticEntry;
      set((state) => {
        if (state.currentProjectId !== projectId) {
          return {
            suggestedQuestionsRevisionByProject: {
              ...state.suggestedQuestionsRevisionByProject,
              [projectId]:
                (state.suggestedQuestionsRevisionByProject[projectId] || 0) + 1,
            },
          };
        }
        const previous = state.knowledge.find((item) => item.id === id);
        const before = semanticCountContribution(previous);
        const after = semanticCountContribution(entry);
        return {
          knowledge: state.knowledge.map((item) => (item.id === id ? entry : item)),
          knowledgeTotal: state.knowledgeTotal + after.total - before.total,
          pendingKnowledgeCount:
            state.pendingKnowledgeCount + after.pending - before.pending,
          relationshipKnowledgeCount:
            state.relationshipKnowledgeCount + after.relationship - before.relationship,
          knowledgeRevisionsByEntry: Object.fromEntries(
            Object.entries(state.knowledgeRevisionsByEntry).filter(
              ([entryId]) => entryId !== id
            )
          ),
          suggestedQuestionsRevisionByProject: {
            ...state.suggestedQuestionsRevisionByProject,
            [projectId]:
              (state.suggestedQuestionsRevisionByProject[projectId] || 0) + 1,
          },
        };
      });
      return entry;
    } catch (error) {
      set({ error: messageFrom(error) });
      throw error;
    } finally {
      set({ isUpdatingKnowledge: false });
    }
  },

  createKnowledge: async (entry) => {
    const projectId = get().currentProjectId;
    if (!projectId) throw new UserFacingError(runtimeMessage("noProjectToUpdate"));
    set({ isUpdatingKnowledge: true, error: null });
    try {
      const response = await api.post(`/api/v1/projects/${projectId}/knowledge`, entry);
      const created = response.data.data as SemanticEntry;
      set((state) => {
        if (state.currentProjectId !== projectId) {
          return {
            suggestedQuestionsRevisionByProject: {
              ...state.suggestedQuestionsRevisionByProject,
              [projectId]:
                (state.suggestedQuestionsRevisionByProject[projectId] || 0) + 1,
            },
          };
        }
        const previous = state.knowledge.find((item) => item.id === created.id);
        const before = semanticCountContribution(previous);
        const after = semanticCountContribution(created);
        return {
          knowledge: [
            created,
            ...state.knowledge.filter((item) => item.id !== created.id),
          ].slice(0, KNOWLEDGE_PREVIEW_LIMIT),
          knowledgeTotal: state.knowledgeTotal + after.total - before.total,
          pendingKnowledgeCount:
            state.pendingKnowledgeCount + after.pending - before.pending,
          relationshipKnowledgeCount:
            state.relationshipKnowledgeCount + after.relationship - before.relationship,
          suggestedQuestionsRevisionByProject: {
            ...state.suggestedQuestionsRevisionByProject,
            [projectId]:
              (state.suggestedQuestionsRevisionByProject[projectId] || 0) + 1,
          },
        };
      });
      return created;
    } catch (error) {
      set({ error: messageFrom(error) });
      throw error;
    } finally {
      set({ isUpdatingKnowledge: false });
    }
  },

  uploadFile: async (file) => {
    const projectId = get().currentProjectId;
    if (!projectId || sourceAdditions.has(projectId)) return;
    set({ error: null });
    await fileUploads.enqueue(projectId, [file]);
    if (get().currentProjectId === projectId) {
      const snapshot = fileUploads.snapshot(projectId);
      const errorKey = snapshot.notice ?? snapshot.items.at(-1)?.errorKey;
      if (errorKey) set({ error: runtimeMessage(errorKey) });
    }
  },

  uploadFiles: async (files) => {
    const projectId = get().currentProjectId;
    if (!projectId) return;
    set({ error: null });
    await fileUploads.enqueue(projectId, files);
  },

  checkUpload: async (itemId, projectId) => {
    const id = projectId ?? get().currentProjectId;
    if (id) await fileUploads.check(id, itemId);
  },

  reselectUpload: async (itemId, file, projectId) => {
    await fileUploads.reselect(projectId, itemId, file);
  },

  pauseUploads: (projectId) => {
    const id = projectId ?? get().currentProjectId;
    if (id) fileUploads.pause(id);
  },

  resumeUploads: async (projectId) => {
    const id = projectId ?? get().currentProjectId;
    if (id) await fileUploads.resume(id);
  },

  retryUpload: async (itemId, projectId) => {
    const id = projectId ?? get().currentProjectId;
    if (id) await fileUploads.retry(id, itemId);
  },

  cancelQueuedUpload: (itemId, projectId) => {
    const id = projectId ?? get().currentProjectId;
    if (id) fileUploads.cancel(id, itemId);
  },

  cancelQueuedUploads: (projectId) => {
    const id = projectId ?? get().currentProjectId;
    if (id) fileUploads.cancelWaiting(id);
  },

  clearUploads: (projectId) => {
    const id = projectId ?? get().currentProjectId;
    if (id) void fileUploads.clear(id);
  },

  attachConnection: async (connectionId, name) => {
    const projectId = get().currentProjectId;
    if (!projectId || sourceAdditions.has(projectId)) return;
    sourceAdditions.add(projectId);
    set({ isUploading: true, error: null });
    try {
      await api.post(
        `/api/v1/projects/${projectId}/sources/connections`,
        { connection_id: connectionId, name }
      );
      if (get().currentProjectId === projectId) await get().refreshCurrent();
    } catch (error) {
      const message = messageFrom(error);
      if (get().currentProjectId === projectId) await get().refreshCurrent();
      if (get().currentProjectId === projectId) set({ error: message });
    } finally {
      sourceAdditions.delete(projectId);
      if (get().currentProjectId === projectId) set({ isUploading: false });
    }
  },

  profileSource: async (sourceId, selection) => {
    const projectId = get().currentProjectId;
    if (!projectId) return;
    if (get().sourceAction) throw new Error("A source action is already running");
    const action = { sourceId, kind: "profile" as const };
    set({ sourceAction: action, error: null });
    try {
      await api.post(
        `/api/v1/projects/${projectId}/sources/${sourceId}/preflight`,
        selection,
        { timeout: 120000 }
      );
      if (get().currentProjectId === projectId) await get().refreshCurrent();
    } catch (error) {
      const message = messageFrom(error);
      if (get().currentProjectId === projectId) await get().refreshCurrent();
      if (get().currentProjectId === projectId) set({ error: message });
      throw error;
    } finally {
      if (get().currentProjectId === projectId && get().sourceAction === action) set({ sourceAction: null });
    }
  },

  replayRecipe: async (projectId, sourceId, recipeId, request) => {
    if (get().currentProjectId !== projectId || get().sourceAction || get().cleaningAction || recipeReplays.has(projectId)) {
      throw new Error("The project or source action has changed");
    }
    const action = { sourceId, kind: "reorganize" as const };
    recipeReplays.add(projectId);
    set({ sourceAction: action, error: null });
    try {
      const source = await applyRecipeReplay(projectId, sourceId, recipeId, request);
      if (get().currentProjectId === projectId) {
        set((state) => ({ sources: state.sources.map((item) => item.id === source.id ? source : item),
          recipeRevisionsByRecipe: { ...state.recipeRevisionsByRecipe, [recipeId]: [] } }));
        // A successful write must not become an apparent failure just because the following read fails.
        await get().refreshCurrent();
        if (get().currentProjectId === projectId) await get().loadRecipeRevisions(recipeId).catch(() => undefined);
      }
    } finally {
      recipeReplays.delete(projectId);
      if (get().currentProjectId === projectId && get().sourceAction === action) set({ sourceAction: null });
    }
  },

  reorganizeSource: async (sourceId) => {
    const projectId = get().currentProjectId;
    if (!projectId) throw new UserFacingError(runtimeMessage("noProjectToClean"));
    set({ sourceAction: { sourceId, kind: "reorganize" }, error: null });
    try {
      const recipesResponse = await api.get(`/api/v1/projects/${projectId}/recipes`);
      const recipe = (recipesResponse.data.data as Array<{ id: string; data_source_id: string }>).find(
        (item) => item.data_source_id === sourceId
      );
      if (recipe) {
        await api.post(
          `/api/v1/projects/${projectId}/recipes/${recipe.id}/reapply`,
          undefined,
          { timeout: 120000 }
        );
      } else {
        await api.post(
          `/api/v1/projects/${projectId}/sources/${sourceId}/preflight`,
          undefined,
          { timeout: 120000 }
        );
      }
      if (get().currentProjectId === projectId) await get().refreshCurrent();
    } catch (error) {
      if (get().currentProjectId === projectId) set({ error: messageFrom(error) });
      throw error;
    } finally {
      if (
        get().currentProjectId === projectId &&
        get().sourceAction?.sourceId === sourceId
      ) {
        set({ sourceAction: null });
      }
    }
  },

  replaceSource: async (projectId, sourceId, request) => {
    if (get().currentProjectId !== projectId || get().sourceAction || sourceReplacements.has(projectId)) {
      throw new Error("The project or source action has changed");
    }
    const action = { sourceId, kind: "replace" as const };
    sourceReplacements.add(projectId);
    set({ sourceAction: action, error: null });
    try {
      const accepted = await applySourceReplacement(projectId, sourceId, request);
      if (get().currentProjectId === projectId) {
        set((state) => ({ sources: state.sources.map((source) => source.id === accepted.id ? accepted
          : source.id === sourceId ? { ...source, status: "superseded", profile_data: { ...source.profile_data, is_current: false, superseded_by: accepted.id } }
            : source) }));
        await get().refreshCurrent();
      }
    } finally {
      sourceReplacements.delete(projectId);
      if (get().currentProjectId === projectId && get().sourceAction === action) set({ sourceAction: null });
    }
  },

  acceptReplacement: async (sourceId) => {
    const projectId = get().currentProjectId;
    if (!projectId) throw new UserFacingError(runtimeMessage("noProjectToProcess"));
    set({ sourceAction: { sourceId, kind: "accept_replacement" }, error: null });
    try {
      const response = await api.post(
        `/api/v1/projects/${projectId}/sources/${sourceId}/accept-replacement`
      );
      const accepted = response.data?.data as ProjectDataSource | undefined;
      if (
        get().currentProjectId === projectId &&
        accepted?.id === sourceId
      ) {
        set((state) => ({
          sources: state.sources.map((source) =>
            source.id === sourceId ? accepted : source
          ),
          preflightReports: state.preflightReports.map((report) =>
            report.data_source_id === sourceId
              ? {
                  ...report,
                  status: accepted.status,
                  summary:
                    accepted.profile_data.summary ||
                    runtimeMessage("sourceVersionAccepted"),
                  source_snapshot: {
                    ...report.source_snapshot,
                    replacement: {
                      status: "accepted",
                      active_source_id: sourceId,
                    },
                  },
                }
              : report
          ),
        }));
      }
      if (get().currentProjectId === projectId) await get().refreshCurrent();
    } catch (error) {
      if (get().currentProjectId === projectId) set({ error: messageFrom(error) });
      throw error;
    } finally {
      if (
        get().currentProjectId === projectId &&
        get().sourceAction?.sourceId === sourceId
      ) {
        set({ sourceAction: null });
      }
    }
  },

  keepTrustedSource: async (sourceId) => {
    const projectId = get().currentProjectId;
    if (!projectId) throw new UserFacingError(runtimeMessage("noProjectToProcess"));
    set({ sourceAction: { sourceId, kind: "keep_trusted" }, error: null });
    try {
      const recipesResponse = await api.get(`/api/v1/projects/${projectId}/recipes`);
      const recipe = (recipesResponse.data.data as Array<{ id: string; data_source_id: string }>).find(
        (item) => item.data_source_id === sourceId
      );
      if (!recipe) throw new UserFacingError(runtimeMessage("noCleaningActionToUndo"));
      await api.post(`/api/v1/projects/${projectId}/recipes/${recipe.id}/undo`);
      if (get().currentProjectId === projectId) await get().refreshCurrent();
    } catch (error) {
      if (get().currentProjectId === projectId) set({ error: messageFrom(error) });
      throw error;
    } finally {
      if (
        get().currentProjectId === projectId &&
        get().sourceAction?.sourceId === sourceId
      ) {
        set({ sourceAction: null });
      }
    }
  },

  removeSource: async (sourceId) => {
    const projectId = get().currentProjectId;
    if (!projectId) throw new UserFacingError(runtimeMessage("noProjectToProcess"));
    set({ sourceAction: { sourceId, kind: "remove" }, error: null });
    try {
      await api.delete(`/api/v1/projects/${projectId}/sources/${sourceId}`);
      if (get().currentProjectId === projectId) await get().refreshCurrent();
    } catch (error) {
      if (get().currentProjectId === projectId) set({ error: messageFrom(error) });
      throw error;
    } finally {
      if (
        get().currentProjectId === projectId &&
        get().sourceAction?.sourceId === sourceId
      ) {
        set({ sourceAction: null });
      }
    }
  },
}));

const fileUploads = new FileUploadQueue({
  journal: uploadJournal,
  claim(projectId) {
    if (sourceAdditions.has(projectId)) return false;
    sourceAdditions.add(projectId);
    return true;
  },
  release(projectId) { sourceAdditions.delete(projectId); },
  changed(projectId, snapshot) {
    useUploadQueueStore.setState((state) => {
      const byProject = { ...state.byProject };
      if (!snapshot.items.length && !snapshot.notice && !snapshot.busy) delete byProject[projectId];
      else byProject[projectId] = snapshot;
      return { byProject };
    });
    const state = useProjectStore.getState();
    const busy = sourceAdditions.has(projectId);
    if (state.currentProjectId === projectId && state.isUploading !== busy) {
      useProjectStore.setState({ isUploading: busy });
    }
  },
  resolve: resolveFileUpload,
  async send(projectId, file, progress, requestId, sha256) {
    const form = new FormData();
    form.append("file", file);
    const response = await api.post(`/api/v1/projects/${projectId}/sources/files`, form, {
      headers: { "Content-Type": undefined, "Idempotency-Key": requestId, ...(sha256 ? { "X-File-SHA256": sha256 } : {}) },
      timeout: 120000,
      onUploadProgress(event) {
        progress(event.total && event.total > 0 ? event.loaded / event.total : null);
      },
    });
    const source = response?.data?.data;
    if (!source || typeof source.id !== "string" || !source.id || source.project_id !== projectId || source.kind !== "file"
      || (sha256 && source.fingerprint !== sha256)) {
      throw new Error("Upload acknowledgement did not identify the project source");
    }
  },
  async settled(projectId) {
    const state = useProjectStore.getState();
    if (state.currentProjectId === projectId) await state.refreshCurrent({ throwOnError: true });
  },
});

let recoveryRead: Promise<void> | undefined;
let recoveryReadRequested = false;

/** Coalesce focus/window notifications; restoring never triggers an API call. */
export function refreshUploadRecovery(): Promise<void> {
  recoveryReadRequested = true;
  if (recoveryRead) return recoveryRead;
  const read = (async () => {
    useUploadQueueStore.setState({ recovery: "loading" });
    do {
      recoveryReadRequested = false;
      try {
        const records = await listPendingUploads();
        fileUploads.restore(records);
        useUploadQueueStore.setState({ recovery: "ready" });
      } catch { useUploadQueueStore.setState({ recovery: "error" }); }
    } while (recoveryReadRequested);
  })();
  recoveryRead = read;
  void read.finally(() => { if (recoveryRead === read) recoveryRead = undefined; });
  return read;
}

export function subscribeUploadRecovery(): () => void {
  const refresh = () => { void refreshUploadRecovery(); };
  const unsubscribe = subscribeUploadJournal(refresh);
  refresh();
  return unsubscribe;
}
