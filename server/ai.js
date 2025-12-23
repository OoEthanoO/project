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
  'openai/gpt-4o-mini': { in: 0.15, out: 0.6 },
  'openai/gpt-4o': { in: 2.5, out: 10 },
  'anthropic/claude-3.5-sonnet': { in: 6, out: 30 }
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
    'Balance the workload across the available days; do not frontload or backload. If work is in units (pages/chapters/problems), distribute units evenly so daily effort is consistent.',
    'Do NOT emit or invent a startDate for subtasks; only use dueDate when needed.',
    modelId === 'anthropic/claude-3.5-sonnet'
      ? 'Use deep reasoning: anticipate risks, add QA/validation steps, and suggest buffers.'
      : modelId === 'openai/gpt-4o'
        ? 'Aim for thorough but concise breakdowns that handle complex constraints.'
        : modelId === 'openai/gpt-4o-mini'
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
              pdf: {
                engine: 'pdf-text'
              }
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
    'You are a concise planning and study coach.',
    'Act stepwise: first skim provided task list, then decide which attachments to inspect. Only inspect requested files.',
    'Reference tasks by name, tighten scope, propose pacing, and suggest reschedules when needed.',
    'Use attached files (images/PDFs/files) to infer missing task names when titles are generic, but only after explicitly requesting them.',
    'Respond in plain paragraphs (no bullets/lists/markdown), clear English sentences only; avoid gibberish or random characters.',
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
          ? `Attachments available (names only): ${allAttachments
              .map((a) => `${a.name || a.type || 'file'} in ${a.parentTitle}`)
              .join(', ')}`
          : 'No attachments available.',
        'Select up to 3 attachments to open by filename. Respond ONLY as JSON: {"files":["filename1","filename2"]}. If none needed, return an empty array.',
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
      if (Array.isArray(parsed?.files)) {
        requestedFiles = parsed.files.slice(0, 3);
      }
    } catch {
      requestedFiles = [];
    }
  }

  const allowedFiles = supportsFiles
    ? allAttachments.filter(
        (a) => requestedFiles.some((name) => (a.name || '').toLowerCase() === (name || '').toLowerCase()) && a.dataUrl
      )
    : [];
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
  const attachmentSummary = summarizeAttachments(
    allAttachments.filter((a) => requestedFiles.includes(a.name || '') && a.extractionStatus === 'ok'),
    3,
    800
  );

  const userContent = [
    {
      type: 'text',
      text: [
        `Today: ${formatDate(now)}`,
        horizon ? `Open items: ${horizon}` : 'No tasks yet.',
        taskLines.length ? `Task context:\n${taskLines.join('\n')}` : '',
        attachmentSummary ? `Attachment excerpts (text files only, opened on request):\n${attachmentSummary}` : '',
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
    plugins:
      supportsFiles && pdfParts.length > 0
        ? [
            {
              id: 'file-parser',
              pdf: {
                engine: 'pdf-text'
              }
            }
          ]
        : undefined
  });

  return { content, usage, modelUsed, totalCostUsd };
};
