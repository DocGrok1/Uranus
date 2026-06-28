
// CRON 9 — Uranus Re-Entry Tick
// Uranus: no-loss preservation + re-entry for blocked/held states
// Checks Uranus archive for states that can now re-enter the pipeline
// Fires Mercury command to route re-entry candidates back to Jupiter
// Authority: Joshua Lopez — DCGP.AI — USPTO 19/555,951
'use strict';
const https = require('https');
function now() { return new Date().toISOString(); }
function send(res, s, p) {
  res.statusCode = s;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Access-Control-Allow-Origin','*');
  res.end(JSON.stringify(p, null, 2));
}
function kvReq(method, path, body) {
  const base = process.env.KV_REST_API_URL, tok = process.env.KV_REST_API_TOKEN;
  if (!base || !tok) return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const full = new URL(base.replace(/\/$/,'') + path);
      const data = body ? JSON.stringify(body) : null;
      const req = https.request({
        hostname: full.hostname, path: full.pathname + full.search, method,
        headers: { Authorization: 'Bearer ' + tok, ...(data ? { 'Content-Type':'application/json','Content-Length':Buffer.byteLength(data) } : {}) }
      }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch{resolve(null)} }); });
      req.on('error',()=>resolve(null));
      req.setTimeout(6000,()=>{req.destroy();resolve(null)});
      if(data)req.write(data); req.end();
    } catch{resolve(null)}
  });
}
const kvGet = k => kvReq('GET','/get/'+encodeURIComponent(k)).then(r=>r?.result?JSON.parse(r.result):null).catch(()=>null);
const kvSet = (k,v,ex) => kvReq('POST','/set/'+encodeURIComponent(k)+(ex?'?ex='+ex:''),v).catch(()=>null);
function postInternal(path, body, ms=12000) {
  const base = 'https://aura115.ai';
  return new Promise(resolve => {
    try {
      const data = JSON.stringify(body);
      const req = https.request({
        hostname: 'aura115.ai', path, method: 'POST',
        headers: { 'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),
          'x-aura-operator-key': process.env.AURA_OPERATOR_KEY || 'Honor_is_the_Reward_of_Virtue' }
      }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve({ok:res.statusCode===200,status:res.statusCode,body:JSON.parse(d)})}catch{resolve({ok:false})} }); });
      req.on('error',()=>resolve({ok:false}));
      req.setTimeout(ms,()=>{req.destroy();resolve({ok:false,error:'timeout'})});
      req.write(data); req.end();
    } catch{resolve({ok:false})}
  });
}

module.exports = async function handler(req, res) {
  const ts = now();
  const uranus_idx = await kvGet('uranus:archive-index:v1');
  const archives = uranus_idx ? (uranus_idx.archives || []) : [];
  const pulse = await kvGet('aura115:constitutional-pulse:v1');
  const gapLB = pulse?.gapLB || 0;
  const reentry_candidates = [];
  for (const archive of archives.slice(-10)) {
    if (archive.flushed_at && gapLB > 0.4) {
      reentry_candidates.push({ key: archive.key, flushed_at: archive.flushed_at,
        entry_count: archive.entry_count, reentry_condition: 'gapLB_sufficient',
        gapLB_at_reentry: gapLB });
    }
  }
  if (reentry_candidates.length > 0) {
    const queue = await kvGet('aura115:mercury:command-queue:v1') || { commands: [] };
    for (const candidate of reentry_candidates.slice(0, 3)) {
      queue.commands.push({ id: 'reentry-' + Date.now(), status: 'pending',
        source_planet: 'uranus', target_planet: 'jupiter',
        payload: { reentry: true, archive_key: candidate.key, gapLB: candidate.gapLB_at_reentry },
        created_at: ts });
    }
    await kvSet('aura115:mercury:command-queue:v1', { commands: queue.commands.slice(-50), updated_at: ts });
  }
  return send(res, 200, { ok:true, cron:'uranus-reentry-tick', ts,
    archives_checked:archives.length, reentry_candidates:reentry_candidates.length,
    gapLB, authority:'Joshua Lopez — DCGP.AI — USPTO 19/555,951' });
};
