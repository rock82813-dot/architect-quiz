// Verify coverage without treating links or empty option notes as explanations.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {window: {}};
vm.createContext(context);
for (const name of ['bank.js', 'sources.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, name), 'utf8'), context, {filename: name});
}
const reviews = context.window.STUDY_CONTENT.reviews;
const invalid = [], missing = [], exams = [];
const known = new Set();
for (const exam of context.window.EXAM_DATA.exams) {
  let count = 0;
  for (const q of exam.questions) {
    const id = `${exam.key}-${q.number}`;
    known.add(id);
    const r = reviews[id];
    if (!r) { missing.push(id); continue; }
    if (!r.explanation?.trim() || r.optionNotes?.length !== 4 ||
        r.optionNotes.some(n => typeof n !== 'string' || n.trim().length < 8) ||
        !r.source?.title || !/^https:\/\//.test(r.source?.url || '')) {
      invalid.push(id);
      continue;
    }
    // This validates explicit single-answer conclusions, not the legal reasoning.
    const answer = r.explanation.match(/(?:應選|選)\s*([A-D])(?:。|，|\s|$)/);
    if (answer && !q.award && !q.accept.includes(answer[1])) {
      invalid.push(`${id}: explanation answer ${answer[1]} disagrees with official ${q.accept}`);
      continue;
    }
    count++;
  }
  exams.push({exam: exam.key, explained: count, total: exam.questions.length});
}
for (const id of Object.keys(reviews)) if (!known.has(id)) invalid.push(`${id}: unknown question`);
const report = {total: known.size, explained: exams.reduce((n,e)=>n+e.explained,0),
  missingCount: missing.length, complete: missing.length === 0 && invalid.length === 0,
  validationScope: 'Checks structure, identifiers, explicit answer agreement and coverage; source accuracy requires substantive review.',
  invalid, exams, missing};
fs.writeFileSync(path.join(__dirname, 'review-coverage.json'), JSON.stringify(report, null, 2)+'\n');
console.log(JSON.stringify({total: report.total, explained: report.explained, missing: report.missingCount, invalid, complete: report.complete}));
if (invalid.length || (process.argv.includes('--require-complete') && !report.complete)) process.exitCode = 1;
