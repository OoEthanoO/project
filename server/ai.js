import fetch from 'node-fetch';
import { priceMap, isFreeModel, supportsFiles, getTierIndex } from '../shared/model-config.js';

const formatDate = (date) => date.toISOString().split('T')[0];

// Helper: Resolve attachment to data URL or presigned URL
const resolveAttachment = async (attachment) => {
  if (attachment.dataUrl) {
    return attachment; // Already has dataUrl
  }
  if (attachment.r2Key) {
    try {
      // Use presigned URL instead of downloading - OpenRouter can fetch directly
      const { getSignedDownloadUrl } = await import('./r2.js');
      const signedUrl = await getSignedDownloadUrl(attachment.r2Key, 3600); // 1 hour expiry
      console.log('[ai] Generated presigned URL for:', attachment.r2Key);
      return { ...attachment, dataUrl: signedUrl }; // OpenRouter accepts https:// URLs
    } catch (err) {
      console.error('[ai] Failed to generate presigned URL:', err.message);
      return attachment; // Return original without dataUrl
    }
  }
  return attachment;
};


const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1/chat/completions';

const ensureKey = () => {
  if (!OPENROUTER_API_KEY) {
    throw new Error('Missing OPENROUTER_API_KEY. Add it to your server env.');
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
      return JSON.parse(sliced);
    }
    throw new Error(`Failed to parse JSON. Raw: ${raw.slice(0, 500)}`);
  }
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

const callOpenRouter = async ({ messages, modelId, plugins }) => {
  ensureKey();
  
  console.log('\n=== AI REQUEST ===');
  console.log('Model:', modelId);
  console.log('Messages:', JSON.stringify(messages, null, 2));
  console.log('=================\n');
  
  const res = await fetch(OPENROUTER_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': process.env.OR_REFERRER || 'http://localhost',
      'X-Title': 'YanPlanner'
    },
    body: JSON.stringify({
      model: modelId,
      messages,
      temperature: 0.2,
      plugins
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter request failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned empty content.');
  
  console.log('\n=== AI RESPONSE ===');
  console.log('Content:', content);
  console.log('==================\n');
  const usage = data?.usage || {};
  const modelUsed = data?.model || modelId;

  const pricing = priceMap[modelUsed] || { in: 0, out: 0 };
  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const promptCost = (promptTokens / 1_000_000) * pricing.in;
  const completionCost = (completionTokens / 1_000_000) * pricing.out;
  const totalCost = promptCost + completionCost;

  console.log(
    `[OpenRouter] model=${modelUsed} prompt_tokens=${promptTokens} completion_tokens=${completionTokens} cost=$${totalCost.toFixed(
      6
    )} (calc: ${promptTokens}/1e6 * $${pricing.in}/M + ${completionTokens}/1e6 * $${pricing.out}/M)`
  );

  return { content, usage, modelUsed, totalCostUsd: totalCost };
};

export const generateSubtasks = async ({ task, ancestors = [], conversation = [], globalInstruction, modelId, clientLocalDate, clientTimeZone }) => {
  const supportsFilesFlag = supportsFiles(modelId);
  // Use the later of task.startDate and today to avoid planning in the past
  const todayDate = clientLocalDate ? new Date(clientLocalDate) : new Date();
  const parsedStartDate = task.startDate ? new Date(task.startDate) : null;
  const hasValidStartDate = parsedStartDate && !Number.isNaN(parsedStartDate.getTime());
  const effectiveStartDate = hasValidStartDate && parsedStartDate > todayDate ? parsedStartDate : todayDate;
  const startDateText = formatDate(effectiveStartDate);
  const recentChat = conversation
    .slice(-4)
    .map((c) => `${c.role === 'user' ? 'User' : 'AI'}: ${c.content}`)
    .join('\n');
  const attachmentContext = (task.attachments || [])
    .filter((a) => a.content && a.extractionStatus === 'ok' && a.contentType !== 'application/pdf')
    .slice(0, 3)
    .map((a) => `${a.name || 'file'}:\n${(a.content || '').slice(0, 800)}`)
    .join('\n---\n');
  
  // Build hierarchy context from ancestors
  const hierarchyParts = ancestors.map((a) => a.title);
  hierarchyParts.push(task.title);
  const hierarchyString = hierarchyParts.join(' > ');
  
  // Resolve attachments from R2 if needed
  console.log('[generateSubtasks] Task attachments:', task.attachments);
  console.log('[generateSubtasks] Model supports files:', supportsFilesFlag);
  console.log('[generateSubtasks] Hierarchy:', hierarchyString);
  
  const imageAttachments = (task.attachments || [])
    .filter((a) => (a.dataUrl && a.dataUrl.startsWith('data:image')) || (a.r2Key && a.contentType?.startsWith('image/')))
    .slice(0, 4);
  const pdfAttachments = (task.attachments || [])
    .filter((a) => (a.dataUrl && a.dataUrl.startsWith('data:application/pdf')) || (a.r2Key && a.contentType === 'application/pdf'))
    .slice(0, 2);
  
  console.log('[generateSubtasks] Found image attachments:', imageAttachments.length);
  console.log('[generateSubtasks] Found pdf attachments:', pdfAttachments.length);
  
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

  const promptText = [
    'Split the given task into concrete, milestone-based subtasks sized to the work. Do NOT assume a daily split.',
    `Today: ${startDateText}. Treat this as the earliest work date (the later of now or any task start).`,
    'If the parent has a due date, keep every subtask on or before it. Still assign a concrete dueDate after today for every subtask.',
    'Be concise and actionable. Every subtask MUST include a dueDate (YYYY-MM-DD). Never return null for dueDate. Due dates must be AFTER today.',
    'Interpret all due dates as deadlines at the START of that day (00:00), so finish work by the prior day if needed.',
    'Distribute work sensibly across the timeline; avoid putting everything at the end, but DO NOT create a subtask for every day.',
    'If work is in units (pages/chapters/problems), group units into a manageable number of subtasks rather than daily slices.',
    'Prefer fewer, higher-impact steps; the user can further split subtasks later if they want daily action items.',
    'IMPORTANT: Ensure completeness and symmetry. If you create a subtask for "first half" or "part 1" of something, you MUST also create corresponding subtasks for "second half" or remaining parts. Never leave partial work incomplete.',
    'Do NOT emit or invent a startDate for subtasks; only use dueDate when needed.',
    getTierIndex(modelId) === 3
      ? 'Use deep reasoning: anticipate risks, add QA/validation steps, and suggest buffers.'
      : getTierIndex(modelId) === 2
        ? 'Aim for thorough but concise breakdowns that handle complex constraints.'
        : getTierIndex(modelId) === 1
          ? 'Balance cost and quality; keep steps focused and leverage attachments when useful.'
          : 'Text-only mode: ignore attachments; rely on titles/descriptions.',
    'Respond ONLY as JSON with shape: {"items":[{"title":"...", "description":"...", "dueDate":"YYYY-MM-DD" | null}]}',
    globalInstruction ? `Global instruction: ${globalInstruction}` : '',
    '',
    ancestors.length > 0 ? `Task hierarchy (root → parent → current): ${hierarchyString}` : '',
    `Today: ${startDateText}`,
    `Task title: ${task.title}`,
    `Task due: ${task.dueDate ?? 'not provided'}`,
    `Task description: ${task.description || 'none'}`,
    `Attachments: ${task.attachments.map((a) => a.name || a.type || 'file').join(', ') || 'none'}`,
    attachmentContext ? `Attachment excerpts:\n${attachmentContext}` : '',
    imageParts.length || pdfParts.length ? 'See attached files for additional context.' : '',
    recentChat ? `Conversation hints:\n${recentChat}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  const userContent = [
    { type: 'text', text: promptText },
    ...imageParts,
    ...pdfParts
  ];

  const { content, usage, modelUsed, totalCostUsd } = await callOpenRouter({
    messages: [
      { role: 'system', content: 'You are a planning assistant that outputs strict JSON. No prose.' },
      { role: 'user', content: userContent }
    ],
    modelId,
    plugins:
      supportsFilesFlag && pdfParts.length > 0
        ? [
            {
              id: 'file-parser',
            }
          ]
        : undefined
  });

  const parsed = parseJsonContent(content);
  const items = parsed.items ?? [];

  const mapped = items.map((item) => ({
    title: item.title,
    description: item.description || `Auto-planned from "${task.title}".`,
    dueDate: item.dueDate ?? null
  }));
  return { items: mapped, usage, modelUsed, totalCostUsd };
};

export const chatWithPlanner = async ({ prompt, tasks, globalInstruction, selectedTaskId, modelId, clientLocalDate, clientTimeZone }) => {
  const supportsFilesFlag = supportsFiles(modelId);
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
    globalInstruction ? `Global instruction: ${globalInstruction}` : ''
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
      const selection = await callOpenRouter({
        messages: [
          { role: 'system', content: 'You select attachments to open. Return only JSON with a files array.' },
          { role: 'user', content: selectionPrompt }
        ],
        modelId
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

  const { content, usage, modelUsed, totalCostUsd } = await callOpenRouter({
    messages: [
      { role: 'system', content: `${system} ${clientTimeZone ? `Assume user's timezone: ${clientTimeZone}.` : ''}` },
      { role: 'user', content: userContent }
    ],
    modelId,
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
