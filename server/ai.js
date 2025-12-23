import fetch from 'node-fetch';

const formatDate = (date) => date.toISOString().split('T')[0];

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'gpt-4o-mini';
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

const priceMap = {
  'meta-llama/llama-3.3-70b-instruct:free': { in: 0, out: 0 },
  'google/gemini-2.5-flash-lite-preview-09-2025': { in: 0.1, out: 0.4 },
  'openai/gpt-5-mini': { in: 0.25, out: 2 },
  'openai/gpt-5.1': { in: 1.25, out: 10 }
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
  const res = await fetch(OPENROUTER_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': process.env.OR_REFERRER || 'http://localhost',
      'X-Title': 'YanPlanner'
    },
    body: JSON.stringify({
      model: modelId || OPENROUTER_MODEL,
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
  const usage = data?.usage || {};
  const modelUsed = data?.model || modelId || OPENROUTER_MODEL;

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

export const generateSubtasks = async ({ task, conversation = [], globalInstruction, modelId }) => {
  const supportsFiles = modelId !== 'meta-llama/llama-3.3-70b-instruct:free';
  const now = new Date();
  let start = now;
  if (task.startDate) {
    const parsed = Date.parse(task.startDate);
    if (!Number.isNaN(parsed)) {
      start = new Date(parsed);
    }
  }
  const startDateText = task.startDate ? String(task.startDate) : 'not provided (default to start now)';
  const recentChat = conversation
    .slice(-4)
    .map((c) => `${c.role === 'user' ? 'User' : 'AI'}: ${c.content}`)
    .join('\n');
  const attachmentContext = (task.attachments || [])
    .filter((a) => a.content && a.extractionStatus === 'ok' && a.contentType !== 'application/pdf')
    .slice(0, 3)
    .map((a) => `${a.name || 'file'}:\n${(a.content || '').slice(0, 800)}`)
    .join('\n---\n');
  const imageParts =
    supportsFiles &&
    (task.attachments || [])
      .filter((a) => a.dataUrl && a.dataUrl.startsWith('data:image'))
      .slice(0, 4)
      .map((a) => ({ type: 'image_url', image_url: { url: a.dataUrl } })) || [];
  const pdfParts =
    supportsFiles &&
    (task.attachments || [])
      .filter((a) => a.dataUrl && a.dataUrl.startsWith('data:application/pdf'))
      .slice(0, 2)
      .map((a) => ({
        type: 'file',
        file: {
          filename: a.name || 'document.pdf',
          file_data: a.dataUrl
        }
      })) || [];

  const promptText = [
    'Split the given task into concrete, daily-size subtasks.',
    'Only schedule subtasks between the start date and the parent due date; no dates before the start date or after the parent due date.',
    'Be concise and actionable. Include optional dueDate per subtask if the parent dueDate exists; keep ISO-8601 (YYYY-MM-DD).',
    'Interpret all due dates as deadlines at the START of that day (00:00), so finish work by the prior day if needed.',
    'Avoid assigning a subtask due on the same day you set it (or on the start date) unless absolutely necessary, because the start of that day has already passed.',
    'Balance the workload across the available days; do not frontload or backload. If work is in units (pages/chapters/problems), distribute units evenly so daily effort is consistent.',
    'Do NOT emit or invent a startDate for subtasks; only use dueDate when needed.',
    modelId === 'openai/gpt-5.1'
      ? 'Use deep reasoning: anticipate risks, add QA/validation steps, and suggest buffers.'
      : modelId === 'openai/gpt-5-mini'
        ? 'Aim for thorough but concise breakdowns that handle complex constraints.'
        : modelId === 'google/gemini-2.5-flash-lite-preview-09-2025'
          ? 'Balance cost and quality; keep steps focused and leverage attachments when useful.'
          : 'Text-only mode: ignore attachments; rely on titles/descriptions.',
    'Respond ONLY as JSON with shape: {"items":[{"title":"...", "description":"...", "dueDate":"YYYY-MM-DD" | null}]}',
    globalInstruction ? `Global instruction: ${globalInstruction}` : '',
    '',
    `Planning start date: ${formatDate(start)}.`,
    `Task title: ${task.title}`,
    `Task due: ${task.dueDate ?? 'not provided'}`,
    `Task earliest start: ${startDateText}`,
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
      supportsFiles && pdfParts.length > 0
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
    dueDate: item.dueDate || task.dueDate
  }));
  return { items: mapped, usage, modelUsed, totalCostUsd };
};

export const chatWithPlanner = async ({ prompt, tasks, globalInstruction, selectedTaskId, modelId }) => {
  const supportsFiles = modelId !== 'meta-llama/llama-3.3-70b-instruct:free';
  const now = new Date();
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

  const allAttachments = supportsFiles
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
    supportsFiles ? 'Only inspect attachments when the user explicitly needs information from files.' : 'NOTE: You are using a text-only model and cannot access file attachments. If a question requires file content, politely explain you cannot open files and suggest the user upgrade to a multimodal model or paste relevant content into task descriptions.',
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
        `Today: ${formatDate(now)}`,
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
  if (supportsFiles && allAttachments.length) {
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

  const allowedFiles = supportsFiles
    ? allAttachments.filter((a) => {
        const nameMatch = requestedFiles.some((name) => (a.name || '').toLowerCase() === (name || '').toLowerCase());
        const hasContent = a.dataUrl && (a.dataUrl.startsWith('data:image') || a.dataUrl.startsWith('data:application/pdf'));
        return nameMatch && hasContent;
      })
    : [];
  
  console.log('[ai/chat] allowedFiles:', allowedFiles.map(a => a.name || 'unnamed'));
  
  const imageParts =
    allowedFiles
      .filter((a) => a.dataUrl && a.dataUrl.startsWith('data:image'))
      .slice(0, 3)
      .map((a) => ({ type: 'image_url', image_url: { url: a.dataUrl } })) || [];
  const pdfParts =
    allowedFiles
      .filter((a) => a.dataUrl && a.dataUrl.startsWith('data:application/pdf'))
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
        `Today: ${formatDate(now)}`,
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
      { role: 'system', content: system },
      { role: 'user', content: userContent }
    ],
    modelId,
    plugins: supportsFiles && pdfParts.length > 0 ? [{ id: 'file-parser' }] : undefined
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
