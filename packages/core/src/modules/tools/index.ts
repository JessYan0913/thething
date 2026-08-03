// Tool factories (backward-compatible AI SDK tool() instances)
export { createBashTool } from './bash';
export { createEditFileTool } from './edit';
export { createWebFetchTool } from './web-fetch';
export { createGlobTool } from './glob';
export { createGrepTool } from './grep';
export { createReadFileTool } from './read';
export { createWriteFileTool } from './write';
export { askUserQuestionTool, repairAskUserQuestionRawInput } from './ask-user-question';
export { createSkillTool } from './skill';
export { createFindSkillsTool } from './find-skills';
export { createCronTool } from './cron';
export { createSaveWikiTool } from './save-wiki';
export { createReadWikiPageTool } from './read-wiki-page';
export { createLintWikiTool } from './lint-wiki';
export { createIngestWikiSourceTool } from './ingest-wiki-source';
export { createInspectWikiHistoryTool } from './inspect-wiki-history';
export { createRestoreWikiRevisionTool } from './restore-wiki-revision';
export { createContextPinTool } from './context-pin';

// Text processing utilities (BOM, line endings)
export { stripBom, detectLineEnding, normalizeToLF, restoreLineEndings } from './utils/text';

// File mutation queue
export { withFileMutationQueue, clearMutationQueues } from './utils/file-mutation-queue';

// Diff generation
export { generateUnifiedDiff } from './utils/diff';
export type { UnifiedDiff } from './utils/diff';

// Image MIME detection
export { detectImageMimeType } from './utils/image';
