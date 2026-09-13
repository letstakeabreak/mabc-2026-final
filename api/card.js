// api/card.js — Vercel 서버리스 함수
// 대시보드 -> /api/card -> Upstage API (Solar Pro 4)
// 프론트에서 직접 Upstage API를 호출하지 않도록 프록시 역할을 한다.
// API 키는 서버 환경변수(UPSTAGE_API_KEY)로만 읽고 클라이언트에 노출하지 않는다.

import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  try { process.loadEnvFile('.env'); } catch (e) {
    console.warn('api/card: .env 로드 실패 (로컬 테스트 시 .env 파일 확인)');
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const apiKey = process.env.UPSTAGE_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    console.error('api/card: UPSTAGE_API_KEY가 설정되지 않았습니다.');
    return res.status(500).json({ error: 'upstage_api_key_not_configured' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'invalid_request_body' });
  }

  const { partName, targetBoard, observations, photoLink, powerInfo } = body;

  // SKILL.md 원문 + references/ 단계별 규칙을 모두 읽어서 system 프롬프트로 사용
  // SKILL.md 자체는 수정하지 않고, 여기서 읽어 병합만 한다.
  const skillDir = path.resolve(process.cwd(), '.hermes/skills/component-integration-card');
  const skillPath = path.join(skillDir, 'SKILL.md');
  const refPaths = [
    'source-evidence-rules.md',
    'electrical-compatibility-gates.md',
    'component-card-template.md',
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
  const systemPrompt = systemParts.join('\n');

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
    max_tokens: 2048,
    temperature: 0.2,
  };

  const upstageUrl = 'https://api.upstage.ai/v1/chat/completions';

  try {
    const upstageRes = await fetch(upstageUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!upstageRes.ok) {
      const status = upstageRes.status;
      let detail = '알 수 없는 오류';
      try {
        const errBody = await upstageRes.text();
        detail = errBody.slice(0, 500);
      } catch (e) {
        detail = `상태 코드: ${status}`;
      }
      console.error(`api/card: Upstage API 오류 ${status}: ${detail}`);
      return res.status(502).json({
        error: 'upstage_api_error',
        status,
      });
    }

    const data = await upstageRes.json();
    const choices = data.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      return res.status(502).json({ error: 'upstage_empty_response' });
    }

    const content = choices[0].message && choices[0].message.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      return res.status(502).json({ error: 'upstage_empty_content' });
    }

    return res.status(200).json({
      ok: true,
      content: content,
      model: data.model,
      usage: data.usage,
    });
  } catch (err) {
    console.error('api/card: 호출 중 예외', err);
    return res.status(502).json({
      error: 'upstage_request_failed',
    });
  }
}
