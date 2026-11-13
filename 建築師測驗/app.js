(() => {
  const $ = id => document.getElementById(id);
  const {exams, archive} = window.EXAM_DATA;
  const {reviews, templates} = window.STUDY_CONTENT;
  const names = {law: '營建法規與實務', build: '建築構造與施工'};
  const modes = {
    practice: ['歷屆練習', '選好科目與年度。點選答案後立即判分，並顯示正解與已收錄的詳解。', '開始練習'],
    instant: ['即時作答', '選一科和一個年度，依考選部原卷順序練習全部 80 題。點選答案立即顯示正解，答錯時展開已收錄的詳解。', '開始即時作答'],
    mock: ['限時模擬', '按每題 1 分 30 秒計時。可回頭改答，交卷後才顯示答案。', '開始模擬'],
    ai: ['AI 出題', '每回 80 題，採建築師考試的四選一形式。同一考點會用不同情境或案例數值反覆練習。', '用 AI 出 80 題'],
    wrong: ['錯題重練', '重做這個瀏覽器記住的歷屆錯題。答對後會移出錯題簿。', '開始重練'],
  };
  const letters = 'ABCD';
  const AI_QUIZ_SIZE = 80;
  const papers = exams.flatMap(exam => exam.questions.map(q => ({
    ...q, exam, id: `${exam.key}-${q.number}`, subject: exam.subject,
  })));
  let mode = 'practice';
  let session = null;
  let timer = null;
  let modelsLoaded = false;
  let generation = 0;
  let wrongIds;
  try { wrongIds = new Set(JSON.parse(localStorage.getItem('architect-wrong-v1') || '[]')); }
  catch { wrongIds = new Set(); }

  function el(tag, content, className) {
    const node = document.createElement(tag);
    if (content !== undefined) node.textContent = content;
    if (className) node.className = className;
    return node;
  }

  function link(label, href) {
    const node = el('a', label);
    node.href = href;
    node.target = '_blank';
    node.rel = 'noopener';
    return node;
  }

  function original(path, page) {
    const url = path.split('/').map(encodeURIComponent).join('/');
    return '../' + url + (page ? '#page=' + page : '');
  }

  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function fillSelect(select, items) {
    const current = select.value;
    select.replaceChildren(...items.map(([value, label]) => {
      const option = el('option', label);
      option.value = value;
      return option;
    }));
    if (items.some(([value]) => String(value) === current)) select.value = current;
  }

  function pool() {
    return papers.filter(q => {
      if ($('subject').value !== 'all' && $('subject').value !== q.subject) return false;
      if (mode === 'wrong') return wrongIds.has(q.id);
      if (verifiedOnly() && !reviews[q.id]) return false;
      return $('year').value === 'all' || q.exam.year === Number($('year').value);
    });
  }

  function verifiedOnly() {
    return mode === 'practice' && $('subject').value !== 'build' && $('verified').checked;
  }

  function updateControls() {
    const ai = mode === 'ai';
    const instant = mode === 'instant';
    $('year-field').hidden = ai || mode === 'wrong';
    $('review-field').hidden = mode !== 'practice';
    $('ai-info').hidden = !ai;
    $('ai-format-field').hidden = !ai;
    $('model-field').hidden = !ai || !modelsLoaded;
    if (ai) {
      $('ai-format-hint').textContent = $('ai-format').value === 'mock'
        ? '限時 120 分鐘，可提前交卷。交卷後才能對答案、查看詳解。'
        : '點選答案後立即顯示正解、逐項解析與依據。';
    }
    const subjects = Object.entries(names);
    if (!instant) subjects.push(['all', '混合兩科']);
    fillSelect($('subject'), subjects);
    const fullBuild = $('subject').value === 'build' && mode !== 'wrong';
    $('review-field').hidden = mode !== 'practice' || fullBuild;
    const bySubject = q => $('subject').value === 'all' || q.subject === $('subject').value;
    const years = [...new Set(papers.filter(q => bySubject(q) &&
      (!verifiedOnly() || reviews[q.id])).map(q => q.exam.year))].sort((a,b) => b-a);
    const yearOptions = years.map(y => [y, `民國 ${y} 年`]);
    if (!instant) yearOptions.unshift(['all', '所有年度']);
    fillSelect($('year'), yearOptions);
    const max = ai ? AI_QUIZ_SIZE : pool().length;
    const counts = fullBuild ? (max >= 80 ? [80] : []) : ai || instant ? (max ? [max] : []) :
      [...new Set([5,10,20,40,80].map(n => Math.min(n, max)))].filter(Boolean);
    fillSelect($('count'), counts.map(n => [n, `${n} 題`]));
    $('start').disabled = !max || (fullBuild && max < 80) || (ai && !modelsLoaded);
    if (instant) {
      const sourced = pool().filter(q => reviews[q.id]).length;
      $('setup-message').textContent = `本卷 ${sourced} / ${max} 題有已核對的詳解`;
    } else {
      $('setup-message').textContent = mode === 'wrong' ? `目前有 ${max} 題` :
        fullBuild && !ai ? `構造科每回 80 題。${max < 80 ? '題庫不足，無法開始。' : '不依詳解收錄狀態刪減題目。'}` : '';
    }
  }

  async function loadModels() {
    $('model-status').textContent = '正在檢查本機模型…';
    try {
      if (location.protocol === 'file:') throw Error('請用「啟動AI.cmd」開啟本機版，再選擇已安裝的 Ollama 模型。');
      const response = await fetch('/api/models');
      if (!response.ok) throw Error('請啟動 Ollama，並先安裝可使用的模型。');
      const models = await response.json();
      if (!models.length) throw Error('Ollama 已啟動。安裝模型後，重新整理此頁。');
      fillSelect($('model'), models.map(m => [m, m]));
      modelsLoaded = true;
      $('model-status').textContent = '出題會使用這台電腦的模型。你也可以直接做下方已核對的情境題。';
    } catch (error) {
      modelsLoaded = false;
      $('model-status').textContent = error.message;
    }
    if (mode === 'ai') updateControls();
  }

  function setMode(value) {
    generation++;
    mode = value;
    const [title, hint, start] = modes[value];
    $('mode-title').textContent = title;
    $('mode-hint').textContent = hint;
    $('start').textContent = start;
    document.querySelectorAll('[data-mode]').forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.mode === value)));
    updateControls();
    if (value === 'ai') loadModels();
  }

  function show(id) {
    for (const view of ['setup', 'quiz', 'results']) $(view).hidden = view !== id;
    window.scrollTo(0, 0);
  }

  function generated(entry, variation, order, ai) {
    const {form, parameter, setting, style} = variation;
    const question = entry.variant ? entry.variant(parameter, form) : {stem: entry.forms[form], choices: entry.choices};
    const choices = order ? order.map(i => question.choices[i]) : shuffle(question.choices);
    const context = entry.settings[setting];
    const contexts = [`情境｜${context}`, `案例判斷｜${context}的討論`, `單選題｜請在${context}中判斷`];
    return {
      id: `generated-${entry.id}-${form}-${parameter}-${setting}-${style}`, subject: entry.subject, stem: question.stem,
      setting: contexts[style], choices, ai, accept: [letters[choices.findIndex(choice => choice.correct)]],
      review: {source: entry.source, explanation: question.explanation || entry.source.summary,
        optionNotes: choices.map(choice => choice.note)},
    };
  }

  function matchingTemplates() {
    return templates.filter(t => $('subject').value === 'all' || t.subject === $('subject').value);
  }

  function buildScenarioQuiz(entries, plans = []) {
    const queues = entries.map(entry => {
      const plan = plans.find(p => p.id === entry.id);
      const groups = [];
      for (const form of entry.forms.keys()) {
        for (const parameter of (entry.parameters || [null]).keys()) {
          const contexts = entry.settings.flatMap((_, setting) =>
            [0, 1, 2].map(style => ({form, parameter, setting, style})));
          const variations = shuffle(contexts);
          if (plan) {
            const preferred = variations.findIndex(v => v.setting === plan.setting && v.style === plan.style);
            variations.unshift(...variations.splice(preferred, 1));
          }
          groups.push(variations);
        }
      }
      const ordered = shuffle(groups);
      if (plan) {
        const preferred = ordered.findIndex(([v]) => v.form === plan.form && v.parameter === plan.parameter);
        ordered.unshift(...ordered.splice(preferred, 1));
      }
      // Use different stems and case values before repeating one with a new setting.
      const variations = ordered[0].flatMap((_, round) => ordered.map(group => group[round]));
      return {entry, plan, variations};
    });
    const questions = [];
    for (let round = 0; questions.length < AI_QUIZ_SIZE; round++) {
      const available = queues.filter(q => q.variations[round]);
      if (!available.length) throw Error('可用情境不足 80 題。');
      for (const {entry, plan, variations} of shuffle(available)) {
        questions.push(generated(entry, variations[round], round === 0 ? plan?.order : null, Boolean(plan)));
        if (questions.length === AI_QUIZ_SIZE) break;
      }
    }
    return questions;
  }

  function startScenarioQuiz(entries, plans = []) {
    const timed = $('ai-format').value === 'mock';
    const source = plans.length ? 'AI' : '離線情境題';
    const format = timed ? '模擬試題' : '即時作答';
    start(buildScenarioQuiz(entries, plans), `${source} · ${format}`, timed);
  }

  async function makeAiQuiz() {
    if ($('start').disabled) return;
    const requestId = ++generation;
    const candidates = matchingTemplates();
    $('start').disabled = true;
    $('setup-message').textContent = '本機模型正在組合新題…';
    try {
      const response = await fetch('/api/generate', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({model: $('model').value, ids: candidates.map(q => q.id)}),
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error || '無法完成出題。');
      if (!Array.isArray(body.plans) || body.plans.length !== candidates.length) throw Error('模型結果未通過題目檢查。');
      const selected = new Set();
      for (const plan of body.plans) {
        const entry = candidates.find(t => t.id === plan.id);
        if (!entry || selected.has(plan.id) || !entry.settings[plan.setting] || !entry.forms[plan.form] || ![0,1,2].includes(plan.style) ||
            !Number.isInteger(plan.parameter) || plan.parameter < 0 || plan.parameter >= (entry.parameters?.length || 1) ||
            !Array.isArray(plan.order) || plan.order.slice().sort().join('') !== '0123') {
          throw Error('模型結果未通過題目檢查，請重試或先做已核對的情境題。');
        }
        selected.add(plan.id);
      }
      if (requestId === generation) startScenarioQuiz(candidates, body.plans);
    } catch (error) {
      if (requestId === generation) $('setup-message').textContent = error.message;
    } finally {
      if (requestId === generation) $('start').disabled = !modelsLoaded;
    }
  }

  function start(items, title, timed) {
    if (!items.length) return;
    clearInterval(timer);
    session = {items, title, timed, at: 0, responses: [], drafts: [], revealed: new Set(), finished: false,
      end: timed ? Date.now() + items.length * 90_000 : null};
    $('multi').checked = false;
    $('session-title').textContent = title;
    show('quiz');
    render();
    if (timed) {
      tick();
      timer = setInterval(tick, 300);
    }
  }

  function tick() {
    const seconds = Math.max(0, Math.ceil((session.end - Date.now()) / 1000));
    $('timer').textContent = `剩餘 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    if (!seconds) finish();
  }

  function correct(q, answer) {
    return Boolean(q.award || (answer && q.accept.includes(answer)));
  }

  function storeWrong(q, answer) {
    if (!q.exam || !answer || q.award) return;
    if (correct(q, answer)) wrongIds.delete(q.id);
    else wrongIds.add(q.id);
    try { localStorage.setItem('architect-wrong-v1', JSON.stringify([...wrongIds])); } catch {}
  }

  function questionImage(q, page, top, bottom) {
    const [width, height] = q.exam.sizes[page - 1];
    const margin = 25;
    const visibleWidth = width - 2 * margin;
    const cropHeight = bottom - top;
    const clip = el('div', undefined, 'clip');
    clip.style.aspectRatio = `${visibleWidth} / ${cropHeight}`;
    const image = el('img');
    image.src = `pages/${q.exam.key}/${page}.webp`;
    image.alt = `原卷第 ${q.number} 題，PDF 第 ${page} 頁`;
    image.style.width = `${100 * width / visibleWidth}%`;
    image.style.left = `${-100 * margin / visibleWidth}%`;
    image.style.top = `${-100 * top / cropHeight}%`;
    image.style.height = `${100 * height / cropHeight}%`;
    clip.append(image);
    return clip;
  }

  function renderFeedback(q, answer, direct) {
    const feedback = $('feedback');
    const yes = correct(q, answer);
    feedback.classList.toggle('error', !yes && !direct);
    const title = q.award ? '本題一律給分' : direct ? '正解已顯示' : !answer ? '本題未作答' : yes ? '答對了' : '這題答錯了';
    feedback.replaceChildren(el('h3', title));
    if (!q.award) {
      feedback.append(el('p', `你的答案：${answer || '未作答'}　｜　給分答案：${q.accept.join('、')}`));
    }
    if (q.notice) feedback.append(el('p', q.notice));
    const review = reviews[q.id] || q.review;
    if (!review) {
      feedback.append(el('p', '這題有考選部答案，尚未收錄可核對的逐項詳解。'));
      if (q.exam) {
        const subject = q.subject === 'law' ? 'regulations' : 'construction';
        const url = `https://architectroad.com/past-papers/${subject}/${q.exam.year}/notes/`;
        if (q.exam.year >= 105 && q.exam.year <= 114) {
          const path = ['建築師', q.exam.year, names[q.subject], q.number].map(encodeURIComponent).join('/');
          const questionNotes = el('p');
          questionNotes.append(link(`看第 ${q.number} 題的第三方 AI 詳解（建好過）`, `https://getarchpass.com/${path}/`));
          feedback.append(questionNotes);
        }
        const paperNotes = el('p');
        paperNotes.append(link(`查閱民國 ${q.exam.year} 年同卷第三方詳解（需登入）`, url));
        feedback.append(paperNotes);
      }
      return;
    }
    feedback.append(el('h4', '詳解'), el('p', review.explanation));
    const list = el('ul', undefined, 'option-reviews');
    review.optionNotes.forEach((note, i) => {
      const letter = letters[i];
      const chosen = Boolean(answer?.includes(letter));
      const credited = q.award || q.accept.includes(letter);
      const inCombination = !credited && q.accept.some(value => value.includes(letter));
      const verdict = q.award ? '一律給分' : credited ? '給分選項' :
        inCombination ? '依組合給分' : '不給分選項';
      const item = el('li');
      if (chosen) item.classList.add('chosen');
      const heading = el('strong', `選項 ${letter} · ${verdict}${chosen ? ' · 你選的答案' : ''}`);
      item.append(heading);
      if (q.choices) item.append(el('p', q.choices[i].text, 'option-text'));
      item.append(el('p', note));
      list.append(item);
    });
    if (direct || !yes || q.review) {
      feedback.append(el('h4', '逐項解析'), list);
    } else {
      const details = el('details');
      details.append(el('summary', '逐項解析'), list);
      feedback.append(details);
    }
    feedback.append(el('h4', '判斷依據'), el('p', review.source.summary),
      link(review.source.title, review.source.url));
  }

  function render() {
    const {at, items, timed, finished, responses, drafts} = session;
    const q = items[at];
    const answer = responses[at];
    const selected = timed && !finished ? answer : (answer ?? drafts[at]);
    const direct = session.revealed.has(at);
    const revealed = finished || direct || (!timed && Boolean(answer));
    const label = q.exam ? `民國 ${q.exam.year} 年 · 原卷第 ${q.number} 題` :
      q.ai ? 'AI 情境題 · 依據已核對' : '情境題 · 依據已核對';
    $('question-meta').textContent = names[q.subject] + ' · ' + label;
    $('progress').textContent = `第 ${at + 1} / ${items.length} 題`;
    $('bar').max = items.length;
    $('bar').value = responses.filter(Boolean).length;
    $('timer').hidden = !timed || finished;
    $('stem').replaceChildren(...(q.exam ? q.parts.map(part => questionImage(q, ...part)) :
      [el('span', q.setting, 'setting'), el('p', q.stem, 'stem-text')]));
    $('choices').classList.toggle('with-text', Boolean(q.choices));
    $('choices').replaceChildren(...[...letters].map((letter,i) => {
      const button = el('button', q.choices ? `${letter}　${q.choices[i].text}` : letter, 'choice');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(Boolean(selected?.includes(letter))));
      button.disabled = revealed;
      if (revealed && !q.award && q.accept.includes(letter)) button.classList.add('correct');
      if (revealed && !correct(q, answer) && answer?.includes(letter)) button.classList.add('incorrect');
      button.addEventListener('click', () => choose(letter));
      return button;
    }));
    $('multi-field').hidden = !q.exam || revealed;
    $('prev').disabled = at === 0;
    $('next').disabled = at === items.length - 1;
    $('check-answer').hidden = timed || revealed || !q.exam || !$('multi').checked;
    $('check-answer').disabled = !selected;
    $('reveal-answer').hidden = mode !== 'instant' || revealed;
    $('feedback').hidden = !revealed;
    if (revealed) renderFeedback(q, answer, direct);
    else $('feedback').replaceChildren();
    $('question-source').replaceChildren();
    if (q.exam) {
      $('question-source').append(link('開啟考選部原卷', original(q.exam.paper, q.parts[0][0])));
      if (revealed) $('question-source').append(link('開啟考選部答案', original(q.exam.answer)));
    }
    $('finish').textContent = finished ? '回到成績' : responses.filter(Boolean).length === items.length ? '交卷' : '提前交卷';
    $('numbers').replaceChildren(...items.map((item, i) => {
      const button = el('button', i + 1);
      button.type = 'button';
      if (responses[i]) button.classList.add('answered');
      if (session.revealed.has(i)) button.setAttribute('aria-label', `第 ${i + 1} 題，已看答案，未作答`);
      if (finished && !correct(item, responses[i])) button.classList.add('wrong');
      if (i === at) button.setAttribute('aria-current', 'step');
      button.addEventListener('click', () => move(i));
      return button;
    }));
  }

  function choose(letter) {
    const {at, items, timed, finished, responses, drafts} = session;
    if (finished || session.revealed.has(at) || (!timed && responses[at])) return;
    if (timed && Date.now() >= session.end) return finish();
    const multi = items[at].exam && $('multi').checked;
    if (!timed && !multi) {
      gradeNow(letter);
      return;
    }
    const target = timed ? responses : drafts;
    if (multi) {
      const old = target[at] || '';
      target[at] = old.includes(letter) ? old.replace(letter,'') : [...old, letter].sort().join('');
    } else {
      target[at] = letter;
    }
    render();
    $('choices').children[letters.indexOf(letter)].focus();
  }

  function gradeNow(answer) {
    const {at, items, responses} = session;
    responses[at] = answer;
    storeWrong(items[at], answer);
    showFeedback();
  }

  function showFeedback() {
    render();
    $('feedback').focus({preventScroll: true});
    $('feedback').scrollIntoView({block:'nearest'});
  }

  function move(index) {
    if (index < 0 || index >= session.items.length) return;
    session.at = index;
    render();
    window.scrollTo(0, 0);
  }

  function finish() {
    clearInterval(timer);
    if (!session.finished) {
      session.finished = true;
      session.items.forEach((q, i) => storeWrong(q, session.responses[i]));
    }
    const {items, responses} = session;
    const earned = items.filter((q,i) => correct(q, responses[i])).length;
    const answered = responses.filter(Boolean).length;
    $('score').textContent = `${Number((earned * 100 / items.length).toFixed(2))} 分`;
    $('breakdown').textContent = `得分題數 ${earned} / ${items.length}　｜　已作答 ${answered} 題　｜　未作答 ${items.length-answered} 題`;
    show('results');
  }

  function exit() {
    if (session && !session.finished && !confirm('返回設定會結束這次作答。確定返回？')) return;
    clearInterval(timer);
    session = null;
    show('setup');
    updateControls();
  }

  document.querySelectorAll('[data-mode]').forEach(button =>
    button.addEventListener('click', () => setMode(button.dataset.mode)));
  for (const id of ['year','subject','verified']) $(id).addEventListener('change', updateControls);
  for (const id of ['subject','model','ai-format']) $(id).addEventListener('change', () => {
    if (mode === 'ai') {
      generation++;
      updateControls();
    }
  });
  $('setup-form').addEventListener('submit', event => {
    event.preventDefault();
    if (mode === 'ai') return makeAiQuiz();
    const filtered = pool();
    const fullBuild = $('subject').value === 'build' && mode !== 'wrong';
    if (fullBuild && filtered.length < 80) {
      $('setup-message').textContent = '構造科題庫不足 80 題，無法開始。';
      return;
    }
    if (mode === 'instant') return start(filtered, modes.instant[0], false);
    const count = fullBuild ? 80 : Number($('count').value);
    const wholePaper = $('year').value !== 'all' && $('subject').value !== 'all' && count === filtered.length;
    start((wholePaper ? filtered : shuffle(filtered)).slice(0,count), modes[mode][0], mode === 'mock');
  });
  $('template-start').onclick = () => {
    generation++;
    $('start').disabled = !modelsLoaded;
    startScenarioQuiz(matchingTemplates());
  };
  $('multi').onchange = () => render();
  $('reveal-answer').onclick = () => {
    const {at, drafts, responses, revealed, finished} = session;
    if (mode !== 'instant' || finished || responses[at]) return;
    drafts[at] = undefined;
    revealed.add(at);
    showFeedback();
  };
  $('check-answer').onclick = () => {
    const answer = session.drafts[session.at];
    if ($('multi').checked && answer) gradeNow(answer);
  };
  $('next').onclick = () => move(session.at + 1);
  $('prev').onclick = () => move(session.at - 1);
  $('exit').onclick = exit;
  $('home').onclick = event => { event.preventDefault(); exit(); };
  $('finish').onclick = () => {
    const missing = session.items.length - session.responses.filter(Boolean).length;
    if (session.finished || !missing || confirm(`還有 ${missing} 題未作答，確定交卷？`)) finish();
  };
  $('inspect').onclick = () => {
    const wrong = session.items.findIndex((q,i) => !correct(q,session.responses[i]));
    session.at = Math.max(0, wrong);
    show('quiz');
    render();
  };
  $('again').onclick = exit;
  $('archive').append(...[...archive].sort((a,b) => b.year-a.year || a.subject.localeCompare(b.subject))
    .map(paper => link(`${paper.year} 年 · ${names[paper.subject]}`, original(paper.paper))));
  setMode('practice');
  $('year').value = '114';
  updateControls();
  $('count').selectedIndex = $('count').options.length - 1;
})();
