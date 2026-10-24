// api/card.js — Vercel 서버리스 함수
// 대시보드 -> /api/card -> Upstage API (Solar Pro 4)
// 프론트에서 직접 Upstage API를 호출하지 않도록 프록시 역할을 한다.
// API 키는 서버 환경변수(UPSTAGE_API_KEY)로만 읽고 클라이언트에 노출하지 않는다.

import fs from 'fs';
import path from 'path';

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024;
const UPSTREAM_TIMEOUT_MS = 25_000;
const FIELD_LIMITS = { partName: 300, targetBoard: 300, observations: 4000, photoLink: 2048, powerInfo: 500 };

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readInput(req) {
  const contentLength = req.headers?.['content-length'];
  if (contentLength !== undefined && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BYTES)) {
    return { status: 413, error: 'request_too_large' };
  }
  const contentType = req.headers?.['content-type'];
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return { status: 415, error: 'json_required' };
  }
  // Browser abuse guard only: this public endpoint still needs the platform's
  // distributed rate limit. Origin is not an authentication credential.
  const origin = req.headers?.origin;
  const host = req.headers?.host;
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return { status: 403, error: 'origin_not_allowed' };
  if (origin !== undefined) {
    try {
      const parsed = new URL(origin);
      const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host || '');
      if (parsed.origin !== origin || parsed.host !== host || parsed.protocol !== (local ? 'http:' : 'https:')) {
        return { status: 403, error: 'origin_not_allowed' };
      }
    } catch {
      return { status: 403, error: 'origin_not_allowed' };
    }
  }
  if (!isRecord(req.body)) return { status: 400, error: 'invalid_request_body' };
  try {
    if (Buffer.byteLength(JSON.stringify(req.body), 'utf8') > MAX_REQUEST_BYTES) {
      return { status: 413, error: 'request_too_large' };
    }
  } catch {
    return { status: 400, error: 'invalid_request_body' };
  }
  if (Object.keys(req.body).some(key => !Object.hasOwn(FIELD_LIMITS, key))) {
    return { status: 400, error: 'invalid_request_fields' };
  }
  const input = {};
  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    const value = req.body[field] === undefined ? '' : req.body[field];
    if (typeof value !== 'string' || value.length > limit || value.includes('\u0000')) {
      return { status: 400, error: 'invalid_request_fields' };
    }
    input[field] = value.trim();
  }
  if (!Object.values(input).some(Boolean)) return { status: 400, error: 'empty_request' };
  if (input.photoLink) {
    try {
      const url = new URL(input.photoLink);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch {
      return { status: 400, error: 'invalid_photo_link' };
    }
  }
  return { input };
}

async function readUpstreamJson(response) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error('invalid_upstream_response');
  }
  if (!response.body) throw new Error('invalid_upstream_response');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('invalid_upstream_response');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
}

function validCard(card) {
  const text = value => typeof value === 'string' && value.length <= 4000;
  const texts = value => Array.isArray(value) && value.length <= 100 && value.every(text);
  return isRecord(card)
    && Number.isInteger(card.stage) && card.stage >= 0 && card.stage <= 5 && text(card.stage_title)
    && texts(card.observed) && texts(card.sources) && texts(card.blocked)
    && texts(card.next_actions) && card.next_actions.length <= 2
    && ['PROVISIONAL', 'BLOCKED', 'VERIFIED'].includes(card.completeness)
    && isRecord(card.identification) && ['ic', 'carrier', 'target'].every(key => text(card.identification[key]))
    && isRecord(card.electrical) && Array.isArray(card.electrical.items) && card.electrical.items.length <= 100
    && card.electrical.items.every(item => isRecord(item) && text(item.gate)
      && ['verified', 'calc', 'unconfirmed', 'blocked'].includes(item.status)
      && (item.evidence === undefined || text(item.evidence)))
    && Array.isArray(card.electrical.conflicts) && card.electrical.conflicts.length <= 100
    && card.electrical.conflicts.every(item => isRecord(item)
      && ['source', 'claim', 'target', 'conflict', 'unblock'].every(key => text(item[key])));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const checked = readInput(req);
  if (checked.error) return res.status(checked.status).json({ error: checked.error });
  const apiKey = process.env.UPSTAGE_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    console.error('api/card: UPSTAGE_API_KEY가 설정되지 않았습니다.');
    return res.status(500).json({ error: 'upstage_api_key_not_configured' });
  }
  const { partName, targetBoard, observations, photoLink, powerInfo } = checked.input;

  // SKILL.md 원문 + references/ 단계별 규칙을 모두 읽어서 system 프롬프트로 사용
  // SKILL.md 자체는 수정하지 않고, 여기서 읽어 병합만 한다.
  const skillDir = path.resolve(process.cwd(), '.hermes/skills/component-integration-card');
  const skillPath = path.join(skillDir, 'SKILL.md');
  const refPaths = [
    'source-evidence-rules.md',
    'electrical-compatibility-gates.md',
    'component-card-template.md',
    'usage-examples.md',
  ];
  const systemParts = [];
  try {
    systemParts.push(fs.readFileSync(skillPath, 'utf-8'));
  } catch (e) {
    console.error('api/card: SKILL.md 읽기 실패', e);
    return res.status(500).json({ error: 'skill_md_read_failed' });
  }
  for (const name of refPaths) {
    const refPath = path.join(skillDir, 'references', name);
    try {
      const text = fs.readFileSync(refPath, 'utf-8');
      systemParts.push(`\n\n\n===== references/${name} =====\n\n${text}`);
    } catch (e) {
      console.warn(`api/card: references/${name} 읽기 실패`, e);
    }
  }
  const systemPrompt = [
    `출력은 반드시 주어진 JSON 스키마를 따른다. 각 키는 SKILL.md 의 일곱 구역과 1:1 대응한다.

  observed      = [관찰 사실]
  identification= [식별 상태]
  sources       = [확인된 자료]
  electrical    = [확인된 전기 조건]
  blocked       = [현재 차단 항목]
  next_actions  = [지금 할 것]
  completeness  = [카드 완성도]

빈 구역은 빈 배열이나 null 이 아니라 문자열 "없음" 을 담은 배열로 둔다.

blocked 에는 실제 안전 차단만 적는다. 단계 진행 조건이 아직 충족되지 않았다는
설명은 차단이 아니므로 next_actions 에 적는다.
blocked 에 내용이 있으면 completeness 는 반드시 "BLOCKED" 이다.

`,
    ...systemParts,
  ].join('\n');

  const userContent = [
    `부품/모듈 이름: ${partName || ''}`,
    `타겟 보드: ${targetBoard || ''}`,
    `관찰 사실: ${observations || ''}`,
    `사진/구매 링크: ${photoLink || ''}`,
    `사용 전원/전압: ${powerInfo || ''}`,
  ].filter(Boolean).join('\\n');

  const payload = {
    model: 'solar-pro4',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    max_tokens: 3000,
    temperature: 0.2,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'component_card',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            stage:        { type: 'integer', minimum: 0, maximum: 5 },
            stage_title:  { type: 'string' },
            observed:     { type: 'array', items: { type: 'string' } },
            identification: {
              type: 'object',
              properties: {
                ic:      { type: 'string' },
                carrier: { type: 'string' },
                target:  { type: 'string' },
              },
              required: ['ic', 'carrier', 'target'],
              additionalProperties: false,
            },
            sources:      { type: 'array', items: { type: 'string' } },
            electrical: {
              type: 'object',
              properties: {
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      gate:      { type: 'string' },
                      status:    { type: 'string', enum: ['verified', 'calc', 'unconfirmed', 'blocked'] },
                      evidence:  { type: 'string' },
                    },
                    required: ['gate', 'status'],
                    additionalProperties: false,
                  },
                },
                conflicts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      source:   { type: 'string' },
                      claim:    { type: 'string' },
                      target:   { type: 'string' },
                      conflict: { type: 'string' },
                      unblock:  { type: 'string' },
                    },
                    required: ['source', 'claim', 'target', 'conflict', 'unblock'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['items', 'conflicts'],
              additionalProperties: false,
            },
            blocked:      { type: 'array', items: { type: 'string' } },
            next_actions: { type: 'array', items: { type: 'string' }, maxItems: 2 },
            completeness: { type: 'string', enum: ['PROVISIONAL', 'BLOCKED', 'VERIFIED'] },
          },
          required: ['stage', 'stage_title', 'observed', 'identification',
                     'sources', 'electrical', 'blocked', 'next_actions', 'completeness'],
          additionalProperties: false,
        },
      },
    },
  };

  const upstageUrl = 'https://api.upstage.ai/v1/chat/completions';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstageRes = await fetch(upstageUrl, {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!upstageRes.ok) {
      const status = upstageRes.status;
      await upstageRes.body?.cancel();
      console.error(`api/card: Upstage API 오류 ${status}`);
      return res.status(502).json({
        error: 'upstage_api_error',
        status,
      });
    }

    const data = await readUpstreamJson(upstageRes);
    if (!isRecord(data)) return res.status(502).json({ error: 'invalid_upstream_response' });
    const choices = data.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      return res.status(502).json({ error: 'upstage_empty_response' });
    }

    const content = choices[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      return res.status(502).json({ error: 'upstage_empty_content' });
    }

    let card = null;
    try {
      card = JSON.parse(content);
    } catch (e) {
      console.error('api/card: invalid card JSON');
      return res.status(502).json({ error: 'card_json_invalid' });
    }
    if (!validCard(card)) return res.status(502).json({ error: 'card_schema_invalid' });

    // 의미 검증: blocked에 "없음" 외 항목이 하나라도 있으면 completeness는 BLOCKED
    if (Array.isArray(card.blocked)) {
      const hasRealBlock = card.blocked.some(function(item) {
        return typeof item === 'string' && item.trim() !== '' && item.trim() !== '없음';
      });
      if (hasRealBlock && card.completeness !== 'BLOCKED') {
        console.warn('api/card: blocked 항목이 있어 completeness를 BLOCKED로 보정');
        card.completeness = 'BLOCKED';
      }
    }

    return res.status(200).json({
      ok: true,
      card: card,
      content: JSON.stringify(card),
      model: data.model,
      usage: data.usage,
    });
  } catch (err) {
    console.error('api/card: upstream request failed');
    if (controller.signal.aborted) return res.status(504).json({ error: 'upstage_timeout' });
    return res.status(502).json({
      error: 'upstage_request_failed',
    });
  } finally {
    clearTimeout(timeout);
  }
}
