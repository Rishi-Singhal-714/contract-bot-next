// All LLM calls live here, so the rest of the codebase never touches the API
// directly. Uses the NVIDIA-hosted DeepSeek endpoint via the OpenAI-compatible SDK.
// IMPORTANT: NVIDIA_API_KEY comes from env — never hardcode it.

import OpenAI from 'openai';
import { config } from './config';
import type { ConversationMessage } from './db';

let _client: OpenAI | null = null;

function getClient() {
  if (!_client) {
    if (!config.nvidiaApiKey) {
      throw new Error('NVIDIA_API_KEY is not set.');
    }
    _client = new OpenAI({
      baseURL: config.nvidiaBaseUrl,
      apiKey: config.nvidiaApiKey,
      timeout: 60_000,
      maxRetries: 2,
    });
  }
  return _client;
}

/**
 * Catches repetition-loop failures (a known failure mode for some models,
 * where the model gets stuck repeating the same phrase instead of stopping)
 * before the text ever reaches an email. Returns true if the text looks broken.
 */
function looksDegenerate(text: string): boolean {
  if (!text || text.trim().length < 5) return true;
  const words = text.split(/\s+/);
  if (words.length < 8) return false;
  const counts: Record<string, number> = {};
  for (let i = 0; i <= words.length - 5; i++) {
    const phrase = words.slice(i, i + 5).join(' ');
    counts[phrase] = (counts[phrase] || 0) + 1;
    if (counts[phrase] >= 3) return true;
  }
  return false;
}

async function chat(
  prompt: string,
  opts: { system?: string; jsonMode?: boolean; maxTokens?: number } = {}
): Promise<string> {
  const { system, jsonMode = false, maxTokens = 1024 } = opts;
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const client = getClient();

  for (let attempt = 0; attempt < 2; attempt++) {
    // provider-specific extra body (mirrors extra_body in the Python SDK) —
    // chat_template_kwargs isn't part of the OpenAI SDK's typed params, so
    // this is built as `any` to avoid tripping TS's excess-property check.
    const params: any = {
      model: config.aiModel,
      messages,
      temperature: jsonMode ? 0.3 : 0.7,
      top_p: 0.95,
      max_tokens: maxTokens,
      chat_template_kwargs: { thinking: false },
      stream: false,
    };

    const completion = await client.chat.completions.create(
      params as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
    );
    const content = (completion.choices[0].message.content || '').trim();

    if (jsonMode || !looksDegenerate(content)) return content;
    console.warn(`Model produced a degenerate/looping response (attempt ${attempt + 1}), retrying`);
  }

  throw new Error(`AI model repeatedly produced degenerate output for prompt: ${prompt.slice(0, 100)}`);
}

export type ReplyClassification = { intent: 'confirmation' | 'changes_requested' | 'unclear'; confidence: number; reasoning: string };

/**
 * Classify an inbound client reply into: confirmation, changes_requested, unclear.
 */
export async function classifyReply(emailBody: string): Promise<ReplyClassification> {
  const system =
    'You are a contract-renewal triage assistant. Classify the client\'s email reply ' +
    'into exactly one of: confirmation, changes_requested, unclear. ' +
    'confirmation = client agrees to renew with no changes. ' +
    'changes_requested = client asks for any change, new term, discount, or raises a ' +
    'question that affects the contract content. ' +
    'unclear = you cannot confidently tell either way. ' +
    'Respond ONLY with compact JSON: ' +
    '{"intent": "...", "confidence": 0.0-1.0, "reasoning": "one short sentence"}';

  const raw = await chat(emailBody, { system, jsonMode: true, maxTokens: 200 });
  try {
    const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(cleaned);
    if (!['confirmation', 'changes_requested', 'unclear'].includes(result.intent)) {
      throw new Error('bad intent');
    }
    return result;
  } catch {
    console.warn('Could not parse classification response:', raw);
    return { intent: 'unclear', confidence: 0.0, reasoning: 'Failed to parse AI response' };
  }
}

export async function summarizeConversation(messages: ConversationMessage[]): Promise<string> {
  const threadText = messages
    .map((m) => `[${m.direction}] ${m.sender} (${m.timestamp}):\n${m.body}`)
    .join('\n\n');
  const system =
    'Summarize this contract-renewal email thread for an employee who has not read it. ' +
    'Be concise: 3-5 sentences. State what the client wants, what the AI has done so far, ' +
    'and what decision the employee needs to make. Plain text, no markdown.';
  return chat(threadText, { system, maxTokens: 300 });
}

export async function draftAcknowledgmentEmail(clientName: string, contractContext = ''): Promise<string> {
  const system =
    'Write a short, polite email reply to a client on behalf of a company\'s contract-renewal ' +
    'assistant. The client has requested changes or added new terms to their contract. ' +
    'Acknowledge their message, explain that as an automated assistant you cannot make ' +
    'decisions on contract terms, and reassure them a member of the team will reach out ' +
    'shortly to follow up. Keep it under 100 words. Sign off as \'Contract Renewals Team\'. ' +
    'Plain text only, no subject line.';
  const prompt = `Client name: ${clientName}\nContext: ${contractContext}`;
  return chat(prompt, { system, maxTokens: 250 });
}

export async function draftSignatureMissingEmail(clientName: string): Promise<string> {
  const system =
    'Write a short, polite email reply to a client on behalf of a company\'s contract-renewal ' +
    'assistant. The client confirmed they want to renew and attached the contract, but the ' +
    'attached copy is missing a signature. Ask them to sign and resend, or attach a signed ' +
    'copy. Keep it under 80 words. Sign off as \'Contract Renewals Team\'. Plain text only, ' +
    'no subject line.';
  const prompt = `Client name: ${clientName}`;
  return chat(prompt, { system, maxTokens: 200 });
}

export async function draftRenewalConfirmationEmail(clientName: string, expiryDate: string): Promise<string> {
  const system =
    'Write a short, warm confirmation email to a client on behalf of a company\'s contract ' +
    'team. Their contract renewal has been reviewed and finalized — confirm it is officially ' +
    'renewed, mention the new term/expiry date, and thank them for their business. Keep it ' +
    'under 90 words. Sign off as \'Contract Renewals Team\'. Plain text only, no subject line.';
  const prompt = `Client name: ${clientName}\nNew expiry date: ${expiryDate}`;
  return chat(prompt, { system, maxTokens: 220 });
}

export async function draftRenewalReminderEmail(
  clientName: string,
  expiryDate: string,
  contractLink: string
): Promise<string> {
  const system =
    'Write a short, professional email reminding a client their contract is approaching ' +
    'expiry and asking them to confirm renewal or let us know about any changes needed. ' +
    'Include the expiry date. Keep it under 100 words. Sign off as \'Contract Renewals Team\'. ' +
    'Plain text only, no subject line.';
  const prompt = `Client name: ${clientName}\nExpiry date: ${expiryDate}\nContract link: ${contractLink}`;
  return chat(prompt, { system, maxTokens: 220 });
}
