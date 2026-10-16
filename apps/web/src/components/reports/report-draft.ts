import type { AnalysisArtifact, AnalysisHistoryItem } from "@/lib/types/api";
import type { ReportBlock, ReportPage } from "@/lib/reports";
import type { ReportDraftPlan, ReportDraftSection } from "@/lib/reports";
import {
  analysisSummaryToReportBlock,
  artifactToReportBlock,
  createReportPage,
  reflowBlocks,
  type ReportBlocksCopy,
} from "@/lib/report-blocks";

export interface InvestigationReportDraft {
  title: string;
  description: string;
  pages: ReportPage[];
}

export interface ReportDraftCopy {
  summaryTitle: string;
  narrativeTitle: string;
  sectionOverview: string;
  sectionDetail: string;
  sectionEvidence: string;
  fallbackTitle: string;
  blocks: ReportBlocksCopy;
  locale: string;
}

function runTitle(run: AnalysisHistoryItem, fallback: string): string {
  return run.report.title?.trim() || run.query.trim() || fallback;
}

function runSummary(run: AnalysisHistoryItem): string {
  return (
    (typeof run.report.summary === "string" && run.report.summary.trim()) ||
    run.query.trim()
  );
}

function withLayout(
  block: ReportBlock,
  layout: Partial<ReportBlock["layout"]>
): ReportBlock {
  return {
    ...block,
    layout: { ...block.layout, ...layout },
  };
}

function hasUserFacingEvidence(artifact: AnalysisArtifact): boolean {
  if (artifact.kind !== "evidence" && artifact.kind !== "file") return false;
  for (const key of ["text", "summary", "description", "value", "message"]) {
    const value = artifact.payload[key];
    if ((typeof value === "string" || typeof value === "number") && String(value).trim()) {
      return true;
    }
  }
  return ["validations", "correction_applications", "evidence", "checks", "items"].some(
    (key) => Array.isArray(artifact.payload[key]) && artifact.payload[key].length > 0
  );
}

function draftPage(
  title: string,
  orderIndex: number,
  blocks: ReportBlock[],
  runId: string,
  narrative = ""
): ReportPage {
  return {
    ...createReportPage(title, orderIndex),
    config: {
      source_analysis_run_id: runId,
      generated_draft: true,
      ...(narrative.trim() ? { narrative: narrative.trim() } : {}),
    },
    blocks: reflowBlocks(blocks),
  };
}

function applyHighlights(
  blocks: ReportBlock[],
  highlights: Record<string, string>
): ReportBlock[] {
  if (!highlights || !Object.keys(highlights).length) return blocks;
  const normalized = new Map<string, string>();
  for (const [key, value] of Object.entries(highlights)) {
    if (typeof value === "string" && value.trim()) {
      normalized.set(key, value.trim());
    }
  }
  if (!normalized.size) return blocks;
  return blocks.map((block) => {
    const text = block.artifact_id && normalized.get(block.artifact_id);
    if (!text) return block;
    return {
      ...block,
      config: { ...block.config, highlight: text.slice(0, 280) },
    };
  });
}

function balancedMetricWidth(count: number): number {
  if (count <= 1) return 6;
  if (count === 2) return 6;
  if (count === 3) return 4;
  return 3;
}

/**
 * Keep consecutive KPI groups visually complete. This makes a three-metric
 * financial summary fill the row instead of leaving an unexplained quarter
 * of the page empty, while preserving the model-selected block order.
 */
export function balanceMetricWidths(blocks: ReportBlock[]): ReportBlock[] {
  const balanced = [...blocks];
  let cursor = 0;
  while (cursor < balanced.length) {
    if (balanced[cursor].block_type !== "metric") {
      cursor += 1;
      continue;
    }
    let end = cursor;
    while (end < balanced.length && balanced[end].block_type === "metric") end += 1;
    for (let chunkStart = cursor; chunkStart < end; chunkStart += 4) {
      const chunkEnd = Math.min(end, chunkStart + 4);
      const width = balancedMetricWidth(chunkEnd - chunkStart);
      for (let index = chunkStart; index < chunkEnd; index += 1) {
        balanced[index] = withLayout(balanced[index], { w: width, h: 2 });
      }
    }
    cursor = end;
  }
  return balanced;
}

/** Pick the right layout dimensions per block type for readable, balanced pages. */
function layoutForBlockType(
  blockType: string,
  section: "overview" | "detail" | "evidence"
): Partial<ReportBlock["layout"]> {
  if (blockType === "metric") return { w: 4, h: 2 };
  if (blockType === "chart") {
    return section === "overview" ? { w: 6, h: 4 } : { w: 12, h: 5 };
  }
  if (blockType === "table") return { w: 12, h: 6 };
  if (blockType === "evidence") return { w: 12, h: 4 };
  // text, filter, and other types
  return { w: 12, h: 3 };
}

function orderBlocks(
  blocks: ReportBlock[],
  selectedIds: string[],
  section: "overview" | "detail" | "evidence"
): ReportBlock[] {
  if (!selectedIds.length) return [];
  const byId = new Map<string, ReportBlock>();
  for (const block of blocks) {
    if (block.artifact_id) byId.set(block.artifact_id, block);
  }
  const ordered: ReportBlock[] = [];
  for (const id of selectedIds) {
    const block = byId.get(id);
    if (block) {
      ordered.push(withLayout(block, layoutForBlockType(block.block_type, section)));
    }
  }
  return ordered;
}

/**
 * Build a complete, editable first draft from already persisted investigation
 * output. The composition is deterministic so report creation never depends on
 * another model call and every imported block keeps its original provenance.
 */
export function createInvestigationReportDraft(
  run: AnalysisHistoryItem,
  artifacts: AnalysisArtifact[],
  copy: ReportDraftCopy,
  startOrderIndex = 0
): InvestigationReportDraft {
  const imported = artifacts
    .filter((artifact) => artifact.kind !== "report")
    .map((artifact) => artifactToReportBlock(artifact, copy.blocks, copy.locale));
  const metrics = imported.filter((block) => block.block_type === "metric");
  const charts = imported.filter((block) => block.block_type === "chart");
  const tables = imported.filter((block) => block.block_type === "table");
  const evidenceArtifactIds = new Set(
    artifacts.filter(hasUserFacingEvidence).map((artifact) => artifact.id)
  );
  const evidence = imported.filter(
    (block) =>
      block.block_type === "evidence" &&
      Boolean(block.artifact_id && evidenceArtifactIds.has(block.artifact_id))
  );
  const narrative = imported.filter((block) => block.block_type === "text");

  const summary = withLayout(analysisSummaryToReportBlock(run, copy.blocks), {
    w: 12,
    h: 2,
  });
  summary.title = copy.summaryTitle;

  const overviewBlocks = [
    summary,
    ...metrics.map((block) => withLayout(block, { w: 4, h: 2 })),
    ...charts.slice(0, 1).map((block) => withLayout(block, { w: 12, h: 5 })),
    ...narrative.map((block) => withLayout(block, { w: 12, h: 3 })),
  ];
  const detailBlocks = [
    ...tables.map((block) => withLayout(block, { w: 12, h: 6 })),
    ...charts.slice(1).map((block) => withLayout(block, { w: 12, h: 5 })),
  ];
  const evidenceBlocks = evidence.map((block) =>
    withLayout(block, { w: 12, h: Math.max(4, block.layout.h) })
  );

  const sections = [
    { title: copy.sectionOverview, blocks: overviewBlocks },
    { title: copy.sectionDetail, blocks: detailBlocks },
    { title: copy.sectionEvidence, blocks: evidenceBlocks },
  ].filter((section, index) => index === 0 || section.blocks.length > 0);

  return {
    title: runTitle(run, copy.fallbackTitle),
    description: runSummary(run),
    pages: sections.map((section, index) =>
      draftPage(
        section.title,
        startOrderIndex + index,
        balanceMetricWidths(section.blocks),
        run.id
      )
    ),
  };
}

/**
 * Compose a draft that follows the LLM-produced plan. Legacy plans keep their
 * deterministic compatibility fallback; structured sections are respected as
 * written, including narrative-only sections.
 */
export function createInvestigationReportDraftFromPlan(
  run: AnalysisHistoryItem,
  artifacts: AnalysisArtifact[],
  plan: ReportDraftPlan,
  copy: ReportDraftCopy,
  startOrderIndex = 0
): InvestigationReportDraft {
  const imported = artifacts
    .filter((artifact) => artifact.kind !== "report")
    .map((artifact) => artifactToReportBlock(artifact, copy.blocks, copy.locale));
  const evidenceArtifactIds = new Set(
    artifacts.filter(hasUserFacingEvidence).map((artifact) => artifact.id)
  );

  const summary = withLayout(analysisSummaryToReportBlock(run, copy.blocks), {
    w: 12,
    h: 2,
  });
  summary.title = copy.summaryTitle;

  const metrics = imported.filter((block) => block.block_type === "metric");
  const charts = imported.filter((block) => block.block_type === "chart");
  const tables = imported.filter((block) => block.block_type === "table");
  const textBlocks = imported.filter((block) => block.block_type === "text");
  const evidenceBlocksFallback = imported.filter(
    (block) =>
      block.block_type === "evidence" &&
      Boolean(block.artifact_id && evidenceArtifactIds.has(block.artifact_id))
  ).map((block) => withLayout(block, { w: 12, h: 4 }));

  const legacySections: ReportDraftSection[] = [
    {
      role: "overview",
      title: copy.sectionOverview,
      purpose: "",
      narrative: plan.overview_text,
      artifact_ids: plan.selected_overview || [],
    },
    {
      role: "detail",
      title: copy.sectionDetail,
      purpose: "",
      narrative: null,
      artifact_ids: plan.selected_detail || [],
    },
    {
      role: "evidence",
      title: copy.sectionEvidence,
      purpose: "",
      narrative: null,
      artifact_ids: plan.selected_evidence || [],
    },
  ];
  const usesStructuredSections = Boolean(plan.sections?.length);
  const plannedSections = usesStructuredSections ? plan.sections! : legacySections;
  const overviewSectionIndex = plannedSections.findIndex(
    (section) => section.role === "overview"
  );
  const claimedArtifactIds = new Set<string>();

  const fallbackForRole = (
    role: ReportDraftSection["role"]
  ): ReportBlock[] => {
    const candidates =
      role === "overview"
        ? [
            ...metrics.map((block) => withLayout(block, { w: 4, h: 2 })),
            ...charts.slice(0, 1).map((block) => withLayout(block, { w: 12, h: 5 })),
            ...textBlocks.map((block) => withLayout(block, { w: 12, h: 3 })),
          ]
        : role === "detail"
          ? [
              ...tables.map((block) => withLayout(block, { w: 12, h: 6 })),
              ...charts.slice(1).map((block) => withLayout(block, { w: 12, h: 5 })),
            ]
          : evidenceBlocksFallback;
    return candidates.filter((block) => {
      if (!block.artifact_id || claimedArtifactIds.has(block.artifact_id)) return false;
      claimedArtifactIds.add(block.artifact_id);
      return true;
    });
  };

  const materialized = plannedSections.flatMap((section, sectionIndex) => {
    const selectedIds = (section.artifact_ids || []).filter((id) => {
      if (claimedArtifactIds.has(id)) return false;
      claimedArtifactIds.add(id);
      return true;
    });
    let blocks = orderBlocks(imported, selectedIds, section.role);
    if (!usesStructuredSections && !blocks.length) {
      blocks = fallbackForRole(section.role);
    }

    const narrative =
      section.narrative?.trim() ||
      (section.role === "overview" ? plan.overview_text?.trim() : "") ||
      "";
    const content: ReportBlock[] = [];
    if (sectionIndex === overviewSectionIndex) content.push(summary);
    content.push(...blocks);
    const canReceiveDetailTable =
      tables.some(
        (block) => !block.artifact_id || !claimedArtifactIds.has(block.artifact_id)
      ) &&
      (section.role === "detail" ||
        /明细|订单|流水|账单|detail|transaction/i.test(
          `${section.title} ${section.purpose}`
        ));
    if (!content.length && !narrative && !canReceiveDetailTable) return [];
    return [
      {
        role: section.role,
        title:
          section.title.trim() ||
          (section.role === "overview"
            ? copy.sectionOverview
            : section.role === "detail"
              ? copy.sectionDetail
              : copy.sectionEvidence),
        narrative,
        blocks: balanceMetricWidths(content),
      },
    ];
  });

  if (overviewSectionIndex < 0) {
    materialized.unshift({
      role: "overview",
      title: copy.sectionOverview,
      narrative: "",
      blocks: [summary],
    });
  }

  const hasDetailTable = materialized.some((section) =>
    section.blocks.some((block) => block.block_type === "table")
  );
  if (!hasDetailTable) {
    const fallbackTable = tables.find(
      (block) => !block.artifact_id || !claimedArtifactIds.has(block.artifact_id)
    );
    const namedDetailIndex = materialized.findIndex((section) =>
      /明细|订单|流水|账单|detail|transaction/i.test(section.title)
    );
    const targetIndex =
      namedDetailIndex >= 0
        ? namedDetailIndex
        : materialized.findIndex((section) => section.role === "detail");
    if (fallbackTable && targetIndex >= 0) {
      materialized[targetIndex] = {
        ...materialized[targetIndex],
        blocks: [
          ...materialized[targetIndex].blocks,
          withLayout(fallbackTable, { w: 12, h: 6 }),
        ],
      };
    }
  }

  const pages = materialized.map((section, index) =>
    draftPage(
      section.title,
      startOrderIndex + index,
      applyHighlights(section.blocks, plan.highlights),
      run.id,
      section.narrative
    )
  );

  return {
    title: plan.title.trim() || runTitle(run, copy.fallbackTitle),
    description: plan.description.trim() || runSummary(run),
    pages,
  };
}
