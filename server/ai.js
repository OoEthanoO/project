import fetch from 'node-fetch';
import { applyWebSearchSetting, getPricingForUsage, hasOnlineSuffix, supportsFiles } from '../shared/model-config.js';

const formatDate = (date) => date.toISOString().split('T')[0];
const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const WORK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WORK_DAY_INDEX = new Map(WORK_DAYS.map((day, index) => [day, index]));
const normalizeWorkDays = (days) => (Array.isArray(days) ? days.filter((day) => WORK_DAY_INDEX.has(day)) : []);
const formatWorkDays = (days) => (days && days.length ? days.join(', ') : 'none');
const WEB_SEARCH_GUIDANCE =
  'Web search is enabled. Use online sources to verify facts and current curricula when planning; if a task references a grade, course, or exam, look up the official syllabus or textbook topics and plan from that.';

// Helper: Resolve attachment to data URL or presigned URL
const resolveAttachment = async (attachment) => {
  if (attachment.dataUrl) {
    return attachment; // Already has dataUrl
  }
  if (attachment.r2Key) {
    try {
      // Use presigned URL instead of downloading - the provider can fetch directly
      const { getSignedDownloadUrl } = await import('./r2.js');
      const signedUrl = await getSignedDownloadUrl(attachment.r2Key, 3600); // 1 hour expiry
      console.log('[ai] Generated presigned URL for:', attachment.r2Key);
      return { ...attachment, dataUrl: signedUrl }; // Provider accepts https:// URLs
    } catch (err) {
      console.error('[ai] Failed to generate presigned URL:', err.message);
      return attachment; // Return original without dataUrl
    }
  }
  return attachment;
};


const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1/chat/completions';
const AI_PROVIDER = process.env.AI_PROVIDER || 'openrouter';
const AI_API_KEY = process.env.AI_API_KEY || OPENROUTER_API_KEY;
const AI_BASE_URL = process.env.AI_BASE_URL || OPENROUTER_BASE_URL;
const AI_REFERER = process.env.AI_REFERER || process.env.OR_REFERRER || 'http://localhost';
const AI_AUTH_HEADER = process.env.AI_AUTH_HEADER || 'Authorization';
const AI_AUTH_PREFIX = process.env.AI_AUTH_PREFIX;

const providerAdapters = {
  openrouter: {
    label: 'OpenRouter',
    buildHeaders: () => ({
      'HTTP-Referer': AI_REFERER,
      'X-Title': 'YanPlanner'
    }),
    buildPayload: ({ modelId, messages, temperature, plugins }) => {
      const payload = { model: modelId, messages, temperature };
      if (plugins?.length) payload.plugins = plugins;
      return payload;
    }
  },
  vertex: {
    label: 'Vertex',
    buildHeaders: () => ({}),
    buildPayload: ({ modelId, messages, temperature }) => ({
      model: modelId,
      messages,
      temperature
    })
  }
};
const activeProvider = providerAdapters[AI_PROVIDER] || providerAdapters.openrouter;
const providerLabel = activeProvider.label || 'AI';

const ensureKey = () => {
  if (!AI_API_KEY) {
    throw new Error('Missing AI_API_KEY (or OPENROUTER_API_KEY/OPENAI_API_KEY). Add it to your server env.');
  }
};

const parseJsonContent = (raw) => {
  const text = (raw || '').trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const sliced = candidate.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(sliced);
      } catch {
        throw new Error(`Failed to parse JSON. Raw: ${raw.slice(0, 500)}`);
      }
    }
    throw new Error(`Failed to parse JSON. Raw: ${raw.slice(0, 500)}`);
  }
};

const attachBillingContext = (err, billing) => {
  if (err && typeof err === 'object') {
    err.billing = billing;
    return err;
  }
  const wrapped = new Error(typeof err === 'string' ? err : 'AI request failed');
  wrapped.billing = billing;
  return wrapped;
};

const summarizeAttachments = (attachments = [], maxItems = 3, maxChars = 800) => {
  return attachments
    .slice(0, maxItems)
    .map((a) => {
      const name = a.name || a.type || 'file';
      const body = (a.content || '').slice(0, maxChars);
      return `${name}:\n${body}`;
    })
    .join('\n---\n');
};

const callAiProvider = async ({ messages, modelId, plugins }) => {
  ensureKey();
  
  console.log('\n=== AI REQUEST ===');
  console.log('Provider:', AI_PROVIDER);
  console.log('Model:', modelId);
  console.log('Messages:', JSON.stringify(messages, null, 2));
  console.log('=================\n');
  
  const authPrefix = AI_AUTH_PREFIX === '' ? '' : (AI_AUTH_PREFIX || 'Bearer');
  const authHeaderValue = authPrefix ? `${authPrefix} ${AI_API_KEY}` : AI_API_KEY;
  const payload = activeProvider.buildPayload({
    modelId,
    messages,
    temperature: 0.2,
    plugins
  });
  const res = await fetch(AI_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [AI_AUTH_HEADER]: authHeaderValue,
      ...activeProvider.buildHeaders()
    },
    body: JSON.stringify(payload)
  });
  const responseHeaders = {};
  res.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  const responseMeta = {
    status: res.status,
    statusText: res.statusText,
    headers: responseHeaders
  };
  if (!res.ok) {
    const text = await res.text();
    console.error(`[${providerLabel}] Non-OK response body:`, text);
    console.error(`[${providerLabel}] Response meta:`, responseMeta);
    throw new Error(`${providerLabel} request failed: ${res.status} ${text}`);
  }
  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (err) {
    console.error(`[${providerLabel}] Failed to parse JSON response:`, {
      error: err?.message || err,
      meta: responseMeta,
      trimmedLength: rawText.trim().length,
      full: rawText,
      length: rawText.length
    });
    throw new Error(`${providerLabel} response parse failed: ${err?.message || err}`);
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${providerLabel} returned empty content.`);
  
  console.log('\n=== AI RESPONSE ===');
  console.log('Content:', content);
  console.log('==================\n');
  const usage = data?.usage || {};
  const modelUsed = data?.model || modelId;

  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const pricing = getPricingForUsage(modelUsed, promptTokens, completionTokens);
  const promptCost = (promptTokens / 1_000_000) * pricing.in;
  const completionCost = (completionTokens / 1_000_000) * pricing.out;
  const totalCost = promptCost + completionCost;

  console.log(
    `[${providerLabel}] model=${modelUsed} prompt_tokens=${promptTokens} completion_tokens=${completionTokens} cost=$${totalCost.toFixed(
      6
    )} (calc: ${promptTokens}/1e6 * $${pricing.in}/M + ${completionTokens}/1e6 * $${pricing.out}/M)`
  );

  return { content, usage, modelUsed, totalCostUsd: totalCost };
};

export const generateSubtasks = async ({ task, ancestors = [], conversation = [], globalInstruction, modelId, webSearchEnabled, clientLocalDate, clientTimeZone }) => {
  const resolvedWebSearchEnabled =
    typeof webSearchEnabled === 'boolean' ? webSearchEnabled : hasOnlineSuffix(modelId || '');
  const resolvedModelId = applyWebSearchSetting(modelId, resolvedWebSearchEnabled);
  const supportsFilesFlag = supportsFiles(resolvedModelId);
  const todayDate = clientLocalDate ? new Date(clientLocalDate) : new Date();
  const todayText = formatDate(todayDate);
  const tomorrowText = formatDate(addDays(todayDate, 1));
  const rootWorkDays = normalizeWorkDays(ancestors.length ? ancestors[0]?.workDays : task.workDays);
  const taskWorkDays = normalizeWorkDays(task.workDays);
  const effectiveWorkDays = taskWorkDays.length ? taskWorkDays : rootWorkDays;
  const recentChat = conversation
    .slice(-4)
    .map((c) => `${c.role === 'user' ? 'User' : 'AI'}: ${c.content}`)
    .join('\n');
  const lineageTasks = [...ancestors, task];
  const lineageAttachments = lineageTasks.flatMap((item) =>
    (item.attachments || []).map((attachment) => ({
      ...attachment,
      parentTitle: item.title || '(untitled)'
    }))
  );
  const lineageDetails = lineageTasks
    .map((item, index) => {
      const label = index === 0 ? 'Root task' : index === lineageTasks.length - 1 ? 'Current task' : `Parent task ${index}`;
      const description = item.description || 'none';
      const attachmentsText = (item.attachments || []).length
        ? item.attachments.map((a) => a.name || a.type || 'file').join(', ')
        : 'none';
      return `${label}: ${item.title || '(untitled)'}\nDescription: ${description}\nAttachments: ${attachmentsText}`;
    })
    .join('\n\n');
  const formatSubtaskLines = (nodes = [], depth = 0) =>
    nodes.flatMap((child) => {
      const title = child.title || '(untitled)';
      const status = child.status || 'open';
      const due = child.dueDate ?? 'none';
      const description = (child.description || '').replace(/\s+/g, ' ').trim();
      const createdBy = child.createdBy || 'user';
      const indent = '  '.repeat(depth);
      const parts = [`${indent}- ${title}`, `status: ${status}`, `due: ${due}`, `by: ${createdBy}`];
      if (description) parts.push(`notes: ${description.slice(0, 120)}`);
      const line = parts.join(' | ');
      const children = formatSubtaskLines(child.children || [], depth + 1);
      return [line, ...children];
    });
  const existingSubtaskLines = formatSubtaskLines(task.children || []).join('\n');
  const attachmentContext = lineageAttachments
    .filter((a) => a.content && a.extractionStatus === 'ok')
    .map((a) => `${a.parentTitle} - ${a.name || 'file'}:\n${a.content || ''}`)
    .join('\n---\n');
  
  // Build hierarchy context from ancestors
  const hierarchyParts = lineageTasks.map((a) => a.title);
  const hierarchyString = hierarchyParts.join(' > ');
  
  // Resolve attachments from R2 if needed
  console.log('[generateSubtasks] Lineage attachments:', lineageAttachments.length);
  console.log('[generateSubtasks] Model supports files:', supportsFilesFlag);
  console.log('[generateSubtasks] Hierarchy:', hierarchyString);
  
  const imageAttachments = lineageAttachments
    .filter((a) => (a.dataUrl && a.dataUrl.startsWith('data:image')) || (a.r2Key && a.contentType?.startsWith('image/')));
  const pdfAttachments = lineageAttachments
    .filter((a) => (a.dataUrl && a.dataUrl.startsWith('data:application/pdf')) || (a.r2Key && a.contentType === 'application/pdf'));
  const attachmentSummary = lineageAttachments.map((a) => ({
    parentTitle: a.parentTitle || '(untitled)',
    name: a.name || a.type || 'file',
    size: a.size || null,
    contentType: a.contentType || a.type || 'unknown',
    extractionStatus: a.extractionStatus || 'unknown',
    hasR2Key: Boolean(a.r2Key)
  }));
  const pdfBytes = pdfAttachments.reduce((sum, a) => sum + (a.size || 0), 0);
  const imageBytes = imageAttachments.reduce((sum, a) => sum + (a.size || 0), 0);

  console.log('[generateSubtasks] Found image attachments:', imageAttachments.length);
  console.log('[generateSubtasks] Found pdf attachments:', pdfAttachments.length);
  console.log('[generateSubtasks] Attachment sizes (kb):', {
    pdf: Math.round(pdfBytes / 1024),
    images: Math.round(imageBytes / 1024)
  });
  console.log('[generateSubtasks] Attachment summary:', attachmentSummary);
  const attachmentMetaText = attachmentSummary
    .map((a) => {
      const sizeKb = a.size ? `${Math.round(a.size / 1024)}kb` : 'size unknown';
      const location = a.hasR2Key ? 'stored remotely' : 'inline';
      return `${a.name} (in ${a.parentTitle}; ${a.contentType}; ${a.extractionStatus}; ${location}; ${sizeKb})`;
    })
    .join(' | ');
  
  const resolvedImages = supportsFilesFlag ? await Promise.all(imageAttachments.map(resolveAttachment)) : [];
  const resolvedPdfs = supportsFilesFlag ? await Promise.all(pdfAttachments.map(resolveAttachment)) : [];
  
  console.log('[generateSubtasks] Resolved images:', resolvedImages.length);
  console.log('[generateSubtasks] Resolved pdfs:', resolvedPdfs.length);
  
  const imageParts = resolvedImages
    .filter((a) => a.dataUrl) // Can be data: URL or https: URL
    .map((a) => ({ type: 'image_url', image_url: { url: a.dataUrl } }));
  const pdfParts = resolvedPdfs
    .filter((a) => a.dataUrl) // Can be data: URL or https: URL
    .map((a) => ({
      type: 'file',
      file: {
        filename: a.name || 'document.pdf',
        file_data: a.dataUrl
      }
    }));
  
  console.log('[generateSubtasks] Final imageParts:', imageParts.length);
  console.log('[generateSubtasks] Final pdfParts:', pdfParts.length);

  const dueDateRequirementLine = `The next subtask MUST have dueDate "${tomorrowText}" (YYYY-MM-DD). Do not use any other date.`;
  const promptText = [
    'Generate exactly ONE next subtask that represents the best thing to do today. Do NOT split into multiple subtasks.',
    'Before planning, gather as much context as possible from what is provided (task hierarchy, descriptions, existing subtasks, attachments if available, recent chat). Use web search when enabled to fill gaps or verify details.',
    `Today: ${todayText}. The next subtask should represent what to work on today.`,
    `Tomorrow: ${tomorrowText}.`,
    dueDateRequirementLine,
    'Interpret due dates as deadlines at the START of that day (00:00), so finish work by the prior day if needed.',
    rootWorkDays.length || taskWorkDays.length
      ? 'Work days indicate when the user can work. Use them as context for what is realistic today, but keep the dueDate fixed to tomorrow.'
      : '',
    rootWorkDays.length || taskWorkDays.length ? `Root work days: ${formatWorkDays(rootWorkDays)}` : '',
    rootWorkDays.length || taskWorkDays.length ? `Current task work days: ${formatWorkDays(taskWorkDays)}` : '',
    rootWorkDays.length || taskWorkDays.length
      ? `Effective work days (use current if set, otherwise root): ${formatWorkDays(effectiveWorkDays)}`
      : '',
    'Pick the highest-impact, most appropriate step to do today. If work is in units (pages/chapters/problems), propose a realistic chunk for today.',
    'Respect existing subtasks under the current task. Do NOT recreate work already completed (status done) or duplicate in-progress/open subtasks; plan only what remains.',
    supportsFilesFlag
      ? 'Treat attachments as ground truth for progress. If files show partially or fully completed work (e.g., first half of a table already filled), do NOT plan that work again - start from what remains even if the description omits it. If the deliverable already looks complete, focus on polish/review/submit instead of redoing it.'
      : 'No file access: rely on the task text for progress; do not assume extra context from attachments.',
    supportsFilesFlag
      ? 'Inspect images/PDFs for completed tables, pasted passages, or filled sections. Assume attachments reflect the latest state even if the description lags.'
      : '',
    'Do NOT emit or invent a startDate for subtasks; only use dueDate.',
    supportsFilesFlag
      ? 'Use deep reasoning: anticipate risks, add QA/validation steps, and propose a doable subtask for today.'
      : 'Text-only mode: ignore attachments; rely on titles/descriptions.',
    'Respond ONLY as JSON with shape: {"items":[{"title":"...", "description":"...", "dueDate":"YYYY-MM-DD"}]}',
    globalInstruction ? `Global instruction: ${globalInstruction}` : '',
    '',
    lineageTasks.length > 1 ? `Task hierarchy (root → parent → current): ${hierarchyString}` : '',
    lineageDetails ? `Lineage context:\n${lineageDetails}` : '',
    `Today: ${todayText}`,
    `Task title: ${task.title}`,
    `Task due: ${task.dueDate ?? 'not provided'}`,
    `Task work days: ${formatWorkDays(taskWorkDays)}`,
    `Task description: ${task.description || 'none'}`,
    existingSubtaskLines ? `Existing subtasks (all levels, respect status/progress):\n${existingSubtaskLines}` : 'Existing subtasks: none',
    `Attachments: ${lineageAttachments.map((a) => `${a.name || a.type || 'file'} (in ${a.parentTitle})`).join(', ') || 'none'}`,
    attachmentMetaText ? `Attachment details: ${attachmentMetaText}` : '',
    attachmentContext ? `Attachment excerpts:\n${attachmentContext}` : '',
    imageParts.length || pdfParts.length ? 'See attached files for current progress—do not redo work already shown there.' : '',
    recentChat ? `Conversation hints:\n${recentChat}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  const userContent = [
    { type: 'text', text: promptText },
    ...imageParts,
    ...pdfParts
  ];

  let content;
  let usage;
  let modelUsed;
  let totalCostUsd;
  try {
    const systemPrompt = [
      'You are a planning assistant that outputs strict JSON. No prose.',
      resolvedWebSearchEnabled ? WEB_SEARCH_GUIDANCE : ''
    ]
      .filter(Boolean)
      .join(' ');
    const result = await callAiProvider({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      modelId: resolvedModelId,
      plugins:
        supportsFilesFlag && pdfParts.length > 0
          ? [
              {
                id: 'file-parser',
              }
            ]
          : undefined
    });
    content = result.content;
    usage = result.usage;
    modelUsed = result.modelUsed;
    totalCostUsd = result.totalCostUsd;
  } catch (err) {
    console.error('[generateSubtasks] AI request failed', {
      modelId: resolvedModelId,
      supportsFiles: supportsFilesFlag,
      imageParts: imageParts.length,
      pdfParts: pdfParts.length,
      error: err?.message || err
    });
    throw err;
  }

  const billing = { usage, modelUsed, totalCostUsd };
  let parsed;
  try {
    parsed = parseJsonContent(content);
  } catch (err) {
    console.error('[generateSubtasks] Failed to parse model response', {
      modelId: resolvedModelId,
      preview: (content || '').slice(0, 200),
      error: err?.message || err
    });
    throw attachBillingContext(err, billing);
  }
  const items = parsed.items ?? [];

  try {
    const nextItem = Array.isArray(items) ? items[0] : null;
    const mapped = nextItem
      ? [
          {
            title: nextItem.title,
            description: nextItem.description || `Auto-planned from "${task.title}".`,
            dueDate: tomorrowText
          }
        ]
      : [];
    return { items: mapped, usage, modelUsed, totalCostUsd };
  } catch (err) {
    console.error('[generateSubtasks] Failed to map model items', {
      modelId: resolvedModelId,
      error: err?.message || err
    });
    throw attachBillingContext(err, billing);
  }
};

export const chatWithPlanner = async ({ prompt, tasks, globalInstruction, selectedTaskId, modelId, webSearchEnabled, clientLocalDate, clientTimeZone }) => {
  const resolvedWebSearchEnabled =
    typeof webSearchEnabled === 'boolean' ? webSearchEnabled : hasOnlineSuffix(modelId || '');
  const resolvedModelId = applyWebSearchSetting(modelId, resolvedWebSearchEnabled);
  const supportsFilesFlag = supportsFiles(resolvedModelId);
  const now = new Date();
  const todayStr = clientLocalDate || formatDate(now);
  const flatten = (list, depth = 0, orderRef = { value: 0 }) =>
    (list || []).flatMap((t) => {
      const order = orderRef.value++;
      const self = { ...t, depth, order };
      return [self, ...flatten(t.children || [], depth + 1, orderRef)];
    });

  const flatTasks = flatten(tasks || []).slice(0, 20);
  const taskLines = flatTasks.map(
    (t) =>
      `${'›'.repeat(t.depth || 0)} ${t.title || '(untitled)'}${t.dueDate ? ` (due ${t.dueDate})` : ''} [${t.status || 'open'}]${
        t.children?.length ? ` [+${t.children.length} subtasks]` : ''
      }${t.description ? ` — ${t.description.slice(0, 60)}` : ''}`
  );

  const allAttachments = supportsFilesFlag
    ? (tasks || []).flatMap((t) =>
        (t.attachments || []).map((a) => ({
          ...a,
          parentTitle: t.title || '(untitled)'
        }))
      )
    : [];

  const horizon = tasks
    .map((t) => `${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ''} [${t.status || 'open'}]`)
    .slice(0, 8)
    .join(' | ');

  const system = [
    'You are a helpful planning and study coach.',
    'CRITICAL: Match your response EXACTLY to what the user asks:',
    '- Direct questions starting with "what", "when", "where", "which", "how many": Answer the question directly in 1-2 sentences. No greeting, no follow-up questions.',
    '- Casual greetings only ("hello", "hi", "hey", "how are you"): Respond warmly in 1-2 sentences without task analysis.',
    '- Planning requests ("help me plan", "what should I do", "suggest a schedule"): Provide detailed task analysis and suggestions.',
    supportsFilesFlag ? 'Only inspect attachments when the user explicitly needs information from files.' : 'NOTE: You are using a text-only model and cannot access file attachments. If a question requires file content, politely explain you cannot open files and suggest the user upgrade to a multimodal model or paste relevant content into task descriptions.',
    'Do not add conversational padding to factual answers. Be precise and direct.',
    'IMPORTANT: Do not use markdown formatting (no **bold**, *italics*, # headers, etc.). Use plain text only.',
    globalInstruction ? `Global instruction: ${globalInstruction}` : '',
    resolvedWebSearchEnabled ? WEB_SEARCH_GUIDANCE : ''
  ]
    .filter(Boolean)
    .join(' ');

  const focused = selectedTaskId ? flatTasks.find((t) => t.id === selectedTaskId) : undefined;

  const selectionPrompt = [
    {
      type: 'text',
      text: [
        `Today: ${todayStr}`,
        horizon ? `Open items: ${horizon}` : 'No tasks yet.',
        taskLines.length ? `Task context:\n${taskLines.join('\n')}` : '',
        focused
          ? `Focused task: ${focused.title || '(untitled)'}${focused.dueDate ? ` (due ${focused.dueDate})` : ''}`
          : 'Focused task: none selected.',
        allAttachments.length
          ? `Attachments available: ${allAttachments
              .map((a) => `"${a.name || a.type || 'file'}" (in ${a.parentTitle})`)
              .join(', ')}`
          : 'No attachments available.',
        'IMPORTANT: Only select files if the user needs specific information from them. For greetings or casual messages, return empty array.',
        'Select attachments by EXACT filename. Respond with ONLY valid JSON: {"files":["exact_filename1.pdf","exact_filename2.pdf"]} or {"files":[]} if none needed.',
        `User request: ${prompt}`
      ]
        .filter(Boolean)
        .join('\n')
    }
  ];

  let requestedFiles = [];
  if (supportsFilesFlag && allAttachments.length) {
    try {
      const selection = await callAiProvider({
        messages: [
          { role: 'system', content: 'You select attachments to open. Return only JSON with a files array.' },
          { role: 'user', content: selectionPrompt }
        ],
        modelId: resolvedModelId
      });
      const parsed = parseJsonContent(selection.content);
      console.log('[ai/chat] file selection response:', selection.content);
      if (Array.isArray(parsed?.files)) {
        requestedFiles = parsed.files.slice(0, 3);
        console.log('[ai/chat] requested files:', requestedFiles);
      }
    } catch (err) {
      console.warn('[ai/chat] file selection failed:', err.message);
      requestedFiles = [];
    }
  }

  const allowedFiles = supportsFilesFlag
    ? allAttachments.filter((a) => {
        const nameMatch = requestedFiles.some((name) => (a.name || '').toLowerCase() === (name || '').toLowerCase());
        const hasContent = a.dataUrl && (a.dataUrl.startsWith('data:image') || a.dataUrl.startsWith('data:application/pdf'));
        const hasR2Key = a.r2Key && (a.contentType?.startsWith('image/') || a.contentType === 'application/pdf');
        return nameMatch && (hasContent || hasR2Key);
      })
    : [];
  
  console.log('[ai/chat] allowedFiles:', allowedFiles.map(a => a.name || 'unnamed'));
  
  // Resolve files from R2 if needed
  const resolvedFiles = await Promise.all(allowedFiles.map(resolveAttachment));
  
  const imageParts =
    resolvedFiles
      .filter((a) => a.dataUrl && (a.dataUrl.startsWith('data:image') || a.dataUrl.startsWith('https://')))
      .slice(0, 3)
      .map((a) => ({ type: 'image_url', image_url: { url: a.dataUrl } })) || [];
  const pdfParts =
    resolvedFiles
      .filter((a) => a.dataUrl && (a.dataUrl.startsWith('data:application/pdf') || a.dataUrl.startsWith('https://')))
      .slice(0, 2)
      .map((a) => ({
        type: 'file',
        file: {
          filename: a.name || 'document.pdf',
          file_data: a.dataUrl
        }
      })) || [];
  const userContent = [
    {
      type: 'text',
      text: [
        `Today: ${todayStr}`,
        horizon ? `Open items: ${horizon}` : 'No tasks yet.',
        taskLines.length ? `Task context:\n${taskLines.join('\n')}` : '',
        focused
          ? `Focused task: ${focused.title || '(untitled)'}${focused.dueDate ? ` (due ${focused.dueDate})` : ''}`
          : 'Focused task: none selected.',
        allowedFiles.length
          ? `Opened attachments: ${allowedFiles.map((a) => a.name || a.type || 'file').join(', ')}`
          : 'No attachments opened. If needed, ask for a specific file next time.',
        'Use subtasks/attachments selectively; do not invent content.',
        `Request: ${prompt}`
      ]
        .filter(Boolean)
        .join('\n')
    },
    ...imageParts,
    ...pdfParts
  ];

  const { content, usage, modelUsed, totalCostUsd } = await callAiProvider({
    messages: [
      { role: 'system', content: `${system} ${clientTimeZone ? `Assume user's timezone: ${clientTimeZone}.` : ''}` },
      { role: 'user', content: userContent }
    ],
    modelId: resolvedModelId,
    plugins: supportsFilesFlag && pdfParts.length > 0 ? [{ id: 'file-parser' }] : undefined
  });

  // Track files that were explicitly opened
  const explicitFiles = allowedFiles.map((a) => a.name || a.type || 'file');
  
  // Also detect files mentioned in the response as a fallback
  const mentionedFiles = allAttachments
    .filter((a) => {
      const name = a.name || '';
      return name && content.includes(name);
    })
    .map((a) => a.name || a.type || 'file');
  
  // Combine and deduplicate
  const attachmentsUsed = [...new Set([...explicitFiles, ...mentionedFiles])];
  
  console.log('[ai/chat] explicitly opened files:', explicitFiles);
  console.log('[ai/chat] files mentioned in response:', mentionedFiles);
  console.log('[ai/chat] returning attachmentsUsed:', attachmentsUsed);
  return { content, usage, modelUsed, totalCostUsd, attachmentsUsed };
};
