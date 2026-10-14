#!/usr/bin/env bun
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { QUALITY_CONTROLS } from './quality-controls.ts'
import { qualityPacket, QUALITY_SYSTEM, QUALITY_RUBRIC_HASH, type QualityPacket } from './quality.ts'
import { CONVERSATIONS } from './conversations.ts'
import type { ConversationResult } from './conversation-runner.ts'

export const REVIEW_DIMENSIONS = ['factuality', 'suitability', 'explanationAccuracy', 'usefulness'] as const
type Dimension = typeof REVIEW_DIMENSIONS[number]
type Labels = Record<Dimension, number | null>
export interface ReviewItem { id: string; packet: QualityPacket }
export interface ReviewKey {
  reviewId: string
  rubricHash: string
  judge?: { model: string; qualityRunId: string; sourceReportHash: string }
  entries: Array<{ id: string; identity: string; locale: 'en' | 'es'; predicted: Labels | null }>
}
export interface HumanReview { reviewId: string; rubricHash: string; reviewer: string; labelSource: 'human'; labels: Array<{ id: string; scores: Labels }> }

/** Unknown, duplicated, missing and stale human rows cannot improve agreement by omission. */
export function compareHumanReview(key: ReviewKey, review: HumanReview) {
  if (new Set(key.entries.map(row => row.id)).size !== key.entries.length) throw new Error('Review key contains duplicate identities')
  if (review.reviewId !== key.reviewId || review.rubricHash !== key.rubricHash || review.labelSource !== 'human' || !review.reviewer?.trim()) throw new Error('Human review identity or reviewer missing')
  const ids = new Set(review.labels.map(row => row.id))
  if (ids.size !== review.labels.length || review.labels.length !== key.entries.length || review.labels.some(row => !key.entries.some(item => item.id === row.id))) throw new Error('Human review is incomplete, duplicated or unknown')
  for (const row of review.labels) for (const name of REVIEW_DIMENSIONS) {
    const value = row.scores[name]
    const allowed = name === 'usefulness' ? [0, 1, 2] : name === 'suitability' ? [null, 0, 1, 2] : [null, 0, 1]
    if (!allowed.includes(value as number)) throw new Error('Human score missing or outside rubric')
  }
  const dimensions = Object.fromEntries(REVIEW_DIMENSIONS.map(name => {
    const pairs = key.entries.map(entry => ({ id: entry.id, locale: entry.locale,
      actual: review.labels.find(row => row.id === entry.id)!.scores[name], predicted: entry.predicted?.[name] }))
    const correct = pairs.filter(pair => pair.predicted !== undefined && pair.predicted === pair.actual).length
    const classes = [...new Set(pairs.filter(pair => pair.actual !== null).map(pair => pair.actual))]
    const classRecall = Object.fromEntries(classes.map(value => {
      const actual = pairs.filter(pair => pair.actual === value)
      return [String(value), { count: actual.length, recall: actual.filter(pair => pair.predicted === value).length / actual.length }]
    }))
    const perLocale = Object.fromEntries(['en', 'es'].map(locale => {
      const subset = pairs.filter(pair => pair.locale === locale)
      return [locale, { count: subset.length, agreement: subset.length ? subset.filter(pair => pair.predicted !== undefined && pair.predicted === pair.actual).length / subset.length : null }]
    }))
    const perOrigin = Object.fromEntries(['conversation', 'diagnostic'].map(origin => {
      const subset = pairs.filter(pair => (key.entries.find(entry => entry.id === pair.id)!.identity.startsWith('control/') ? 'diagnostic' : 'conversation') === origin)
      return [origin, { count: subset.length, agreement: subset.length ? subset.filter(pair => pair.predicted !== undefined && pair.predicted === pair.actual).length / subset.length : null }]
    }))
    const matrix: Record<string, number> = {}
    for (const pair of pairs) { const cell = `${pair.actual ?? 'NA'}->${pair.predicted === undefined ? 'ERROR' : pair.predicted ?? 'NA'}`; matrix[cell] = (matrix[cell] ?? 0) + 1 }
    const agreement = pairs.length ? correct / pairs.length : 0
    const sufficient = pairs.length >= 24 && classes.length >= 2 && Object.values(classRecall).every(value => value.count >= 2)
      && Object.values(perLocale).every(value => value.count >= 8)
    const calibrated = sufficient && agreement >= 0.9 && Object.values(classRecall).every(value => value.recall >= 0.9)
      && Object.values(perLocale).every(value => value.agreement !== null && value.agreement >= 0.9)
    return [name, { count: pairs.length, agreement, matrix, classRecall, perLocale, perOrigin, sufficient, calibrated,
      disagreements: pairs.filter(pair => pair.predicted === undefined || pair.predicted !== pair.actual) }]
  }))
  return { reviewer: review.reviewer, labelSource: 'human', rubricHash: key.rubricHash, judge: key.judge,
    calibrated: Object.values(dimensions).every(dimension => dimension.calibrated), dimensions }
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))

export function renderHumanReview(items: ReviewItem[], key: ReviewKey): string {
  // No model scores, original case names or control labels are delivered to the reviewer.
  const payload = JSON.stringify({ reviewId: key.reviewId, rubricHash: key.rubricHash, items }).replace(/</g, '\\u003c')
  return String.raw`<!doctype html><html lang="en"><meta charset="utf-8"><title>BA Eventos quality review</title>
<style>body{font:16px system-ui;background:#f7f5f1;color:#25221e;max-width:950px;margin:40px auto;padding:0 20px}h1{font-size:28px}section{background:white;padding:24px;margin:20px 0;border:1px solid #ddd;border-radius:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}select,input,button{font:inherit;padding:8px}label{display:block;margin:12px 0}button{background:#243f31;color:white;border:0;border-radius:6px;cursor:pointer}.muted{color:#666}blockquote{border-left:3px solid #abc;padding-left:16px;white-space:pre-wrap}</style>
<h1>BA Eventos quality review</h1><p>Review the response and the source evidence independently. Your answers are not prefilled. Model grades are hidden. This file makes no network requests.</p>
<p>Factuality: 1 = all factual prose is supported; 0 = any invented or contradicted claim; N/A = no factual claim. Suitability: 2 = clear source-backed fit; 1 = uncertain/partial; 0 = mismatch; N/A = no event card. Explanation accuracy: 1 = every recommendation reason is grounded; 0 = any invented/overstated reason; N/A = no reasons. Usefulness: 2 = directly helps; 1 = partly helps; 0 = misleading or wrong task. Judge the card and prose together; concise prose need not repeat card facts.</p>
<details><summary>Full scoring rubric</summary><pre>${escapeHtml(QUALITY_SYSTEM)}</pre></details>
<label>Your name or reviewer identifier <input id="reviewer" autocomplete="off"></label>
<p id="progress" class="muted"></p><button id="save">Save review progress</button><label>Resume a saved review <input id="resume" type="file" accept="application/json"></label>
<nav style="position:sticky;top:0;background:#f7f5f1;padding:12px 0;z-index:1"><button id="previous">Previous</button> <select id="jump" aria-label="Review example"></select> <button id="next">Next</button></nav>
<div id="items"></div>
<script type="application/json" id="data">${payload}</script>
<script>
const data=JSON.parse(document.getElementById('data').textContent), labels={};
const dimensions=['factuality','suitability','explanationAccuracy','usefulness'];
const titles={factuality:'Factuality',suitability:'Suitability',explanationAccuracy:'Explanation accuracy',usefulness:'Usefulness'};
function element(tag,text,parent){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(parent)parent.append(node);return node}
function update(){const complete=data.items.filter(item=>dimensions.every(name=>labels[item.id][name]!==undefined)).length;document.getElementById('progress').textContent=complete+' of '+data.items.length+' examples complete. You can save a partial review and finish later; calibration requires all examples.'}
function eventFacts(event,parent,locale){element('h4',event.name||'Event',parent);const description=locale==='es'?(event.description_display_es||event.description_es||event.description_en):(event.description_display_en||event.description_en||event.description_es);element('p',event.description_unavailable?'The supplied source has no description.':description||'No description supplied.',parent);const facts=[['Starts',event.starts_at],['Ends',event.ends_at],['Venue',event.venue_name],['Neighborhood',event.venue_neighborhood],['Address',event.venue_address],['Price',event.price],['Marked free',event.is_free],['Minimum age',event.min_age]];for(const [name,value]of facts)if(value!==undefined)element('p',name+': '+(value===null?'Not stated':String(value)),parent)}
for(const item of data.items){
 labels[item.id]={};const p=item.packet,section=element('section',undefined,document.getElementById('items'));section.dataset.reviewId=item.id;
 element('h2',item.id+' · '+(p.locale==='es'?'Spanish':'English'),section);element('p','Request: '+p.message,section);
 const history=element('details',undefined,section);element('summary','Earlier conversation and options',history);
 for(const message of p.evidence.messages){const text=typeof message.content==='string'?message.content:message.content.filter(part=>part.type==='text').map(part=>part.text).join('\n');element('p',message.role+': '+text.replace(/^UNTRUSTED DATA: /,''),history)}
 for(const line of p.evidence.activeServerState.split('\nPinned event is available as eventRef')[0].split('\n')){const at=line.indexOf('=');if(at>=0){try{const fact=JSON.parse(line.slice(at+1));element('p','Prior option '+fact.position+': '+fact.name+(fact.venue?' at '+fact.venue:''),history)}catch{}}}
 element('h3','Visible response',section);element('blockquote',[p.prose.text,p.prose.framing?.nextStep,...p.prose.reasons].filter(Boolean).join('\n'),section);
 const cards=element('details',undefined,section);element('summary','Displayed cards and directions',cards);
 for(const card of p.cards)eventFacts(card,cards,p.locale);if(p.directions)element('p','Directions: '+p.directions.venueName+' — '+p.directions.address,cards);if(p.venue)element('p','Venue: '+p.venue.venueName,cards);for(const question of p.clarificationQuestions)element('p',question.label,cards);
 element('h3','Source evidence the app supplied',section);
 for(const read of p.evidence.toolResults){if(!read.success){element('p','A read failed; it supplies no factual evidence.',section);continue}const output=read.output||{};for(const event of output.events||[])eventFacts(event,section,p.locale);if(output.directions)element('p','Directions source: '+output.directions.venueName+' — '+output.directions.address,section);if(output.venue)element('p','Venue source: '+output.venue.venueName,section);if(output.metadata?.coverage)element('p','Search returned '+output.metadata.coverage.returned+' options from '+output.metadata.coverage.totalMatches+' matches in the searched scope.',section)}
 const evidence=element('details',undefined,section);element('summary','Inspect complete read data',evidence);element('pre',JSON.stringify(p.evidence.toolResults,null,2),evidence);
 for(const name of dimensions){const label=element('label',titles[name]+' ',section),select=element('select',undefined,label);select.dataset.id=item.id;select.dataset.dimension=name;element('option','Choose a score',select).value='';const choices=name==='usefulness'?[0,1,2]:name==='suitability'?['NA',0,1,2]:['NA',0,1];for(const choice of choices)element('option',String(choice),select).value=String(choice);select.onchange=()=>{if(select.value==='')delete labels[item.id][name];else labels[item.id][name]=select.value==='NA'?null:Number(select.value);update()}}
}update();
let current=0;const jump=document.getElementById('jump');for(const [index,item]of data.items.entries())element('option',item.id+' · '+(item.packet.locale==='es'?'Spanish':'English'),jump).value=String(index);function show(index){current=Math.max(0,Math.min(data.items.length-1,index));jump.value=String(current);for(const [position,section]of document.querySelectorAll('section').entries())section.hidden=position!==current;document.getElementById('previous').disabled=current===0;document.getElementById('next').disabled=current===data.items.length-1}jump.onchange=()=>show(Number(jump.value));document.getElementById('previous').onclick=()=>show(current-1);document.getElementById('next').onclick=()=>show(current+1);show(0);
document.getElementById('resume').onchange=async event=>{try{const saved=JSON.parse(await event.target.files[0].text());if(saved.reviewId!==data.reviewId||saved.rubricHash!==data.rubricHash)throw new Error('This review belongs to a different packet.');document.getElementById('reviewer').value=saved.reviewer||'';for(const row of saved.labels){if(!Object.hasOwn(labels,row.id))throw new Error('Unknown review example.');labels[row.id]=row.scores}for(const select of document.querySelectorAll('select[data-id]')){const value=labels[select.dataset.id][select.dataset.dimension];select.value=value===undefined?'':value===null?'NA':String(value)}update()}catch(error){alert('Could not resume review: '+error.message)}};
document.getElementById('save').onclick=()=>{const reviewer=document.getElementById('reviewer').value.trim();if(!reviewer){alert('Enter a reviewer identifier first.');return}const result={reviewId:data.reviewId,rubricHash:data.rubricHash,reviewer,labelSource:'human',labels:data.items.map(item=>({id:item.id,scores:labels[item.id]}))};const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));link.download='ba-eventos-human-review.json';link.click();URL.revokeObjectURL(link.href)};
</script></html>`
}

async function main() {
  const args = process.argv.slice(2)
  const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
  const keyPath = option('--key'), labelsPath = option('--labels')
  if (keyPath && labelsPath) {
    const result = compareHumanReview(JSON.parse(await readFile(keyPath, 'utf8')), JSON.parse(await readFile(labelsPath, 'utf8')))
    const output = labelsPath.replace(/\.json$/, '') + '.calibration.json'
    await writeFile(output, JSON.stringify(result, null, 2))
    console.log('Calibration: ' + (result.calibrated ? 'passed' : 'needs review or more labeled examples'))
    console.log('Report: ' + output)
    if (!result.calibrated) process.exitCode = 1
    return
  }
  const sourcePath = option('--source'), qualityPath = option('--quality'), controlsPath = option('--controls')
  if (!sourcePath || !qualityPath) throw new Error('--source and --quality required, or --key and --labels to compare')
  const sourceText = await readFile(sourcePath, 'utf8'), quality = JSON.parse(await readFile(qualityPath, 'utf8'))
  if (quality.metadata.selectedCase) throw new Error('Use a full quality run for the bilingual review packet')
  if (quality.metadata.sourceReportHash !== createHash('sha256').update(sourceText).digest('hex') || quality.metadata.rubricHash !== QUALITY_RUBRIC_HASH) throw new Error('Quality receipt does not match source or rubric')
  const source = JSON.parse(sourceText) as { results: ConversationResult[] }
  const entries: Array<{ identity: string; locale: 'en' | 'es'; packet: QualityPacket; predicted: Labels | null }> = []
  for (const result of source.results.filter(result => result.trial === 1)) for (const turn of result.turns) {
    const scenario = CONVERSATIONS.find(item => item.id === result.caseId)
    if (!scenario || !turn.run) throw new Error('Review source turn missing')
    const prediction = quality.results.find((row: any) => row.caseId === result.caseId && row.trial === result.trial && row.index === turn.index)
    entries.push({ identity: `${result.caseId}/${result.trial}/${turn.index}`, locale: scenario.locale,
      packet: qualityPacket(turn.message, scenario.locale, turn.run), predicted: prediction?.scores ?? null })
  }
  if (controlsPath) {
    const controls = JSON.parse(await readFile(controlsPath, 'utf8'))
    if (controls.metadata.rubricHash !== QUALITY_RUBRIC_HASH || controls.metadata.model !== quality.metadata.judgeModel) throw new Error('Control rubric or judge-model mismatch')
    for (const control of QUALITY_CONTROLS) {
      const predicted = controls.results.find((row: any) => row.id === control.id)
      entries.push({ identity: 'control/' + control.id, locale: control.locale, packet: qualityPacket(control.message, control.locale, control.run), predicted: predicted?.scores ?? null })
    }
  }
  const reviewId = randomUUID()
  // Deterministically shuffle by a fresh opaque review identity; neither quality nor case order is exposed.
  entries.sort((left, right) => createHash('sha256').update(reviewId + left.identity).digest('hex').localeCompare(createHash('sha256').update(reviewId + right.identity).digest('hex')))
  const key: ReviewKey = { reviewId, rubricHash: QUALITY_RUBRIC_HASH,
    judge: { model: quality.metadata.judgeModel, qualityRunId: quality.metadata.runId, sourceReportHash: quality.metadata.sourceReportHash },
    entries: entries.map((entry, index) => ({ id: `R${String(index + 1).padStart(3, '0')}`, identity: entry.identity, locale: entry.locale, predicted: entry.predicted })) }
  const items = entries.map((entry, index) => ({ id: key.entries[index].id, packet: entry.packet }))
  const base = qualityPath.replace(/\.json$/, '') + '.human-review'
  await writeFile(base + '.key.json', JSON.stringify(key, null, 2))
  await writeFile(base + '.html', renderHumanReview(items, key))
  console.log(`${items.length} blinded review examples`)
  console.log('Review: ' + base + '.html')
  console.log('Private comparison key: ' + base + '.key.json')
}
if (import.meta.main) main().catch(error => { console.error(error instanceof Error ? error.message : 'Review setup failed'); process.exitCode = 1 })
