const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const port = Number(process.env.ARCHITECT_QUIZ_PORT || 8765);
const host = `127.0.0.1:${port}`;
const ollama = 'http://127.0.0.1:11434';
const context = {window: {}};
for (const script of ['bank.js', 'sources.js']) {
  vm.runInNewContext(fs.readFileSync(path.join(root, script), 'utf8'), context, {filename: script});
}
const {templates} = context.window.STUDY_CONTENT;
const {exams, archive} = context.window.EXAM_DATA;
const papers = new Set([...exams.flatMap(e => [e.paper, e.answer]), ...archive.map(e => e.paper)]);
const appFiles = new Set(['開始測驗.html','style.css','bank.js','sources.js','app.js']);
const mime = {'.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.webp':'image/webp', '.pdf':'application/pdf'};

function json(response, status, value) {
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  response.end(JSON.stringify(value));
}

async function modelNames() {
  const response = await fetch(ollama + '/api/tags', {signal: AbortSignal.timeout(3500)});
  if (!response.ok) throw Error('無法讀取 Ollama 模型。');
  const result = await response.json();
  return (result.models || []).map(model => model.name).filter(name => typeof name === 'string');
}

async function readRequest(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw Error('出題要求太長。');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function generate(request, response) {
  if (request.headers.origin !== 'http://' + host ||
      !request.headers['content-type']?.startsWith('application/json')) {
    return json(response,403,{error:'請從本機測驗頁出題。'});
  }
  let input;
  try { input = await readRequest(request); }
  catch { return json(response,400,{error:'出題要求格式不符。'}); }
  const {model, ids} = input || {};
  if (typeof model !== 'string' || !Array.isArray(ids) || !ids.length || ids.length > templates.length ||
      new Set(ids).size !== ids.length || ids.some(id => !templates.some(t => t.id === id))) {
    return json(response,400,{error:'請選擇模型、科目和題數。'});
  }
  let available;
  try { available = await modelNames(); }
  catch { return json(response,503,{error:'無法連線到 Ollama。請先啟動它。'}); }
  if (!available.includes(model)) return json(response,400,{error:'請選擇已安裝的本機模型。'});

  const choices = ids.map(id => {
    const t = templates.find(t => t.id === id);
    return {id, forms: t.forms, settings: t.settings, parameters: t.parameters || ['本題無變動數值'],
      choices: t.choices?.map(c => c.text)};
  });
  const item = {type:'object',additionalProperties:false,required:['id','setting','style','form','parameter','order'],
    properties:{id:{type:'string',enum:ids},setting:{type:'integer',enum:[0,1,2]},
      style:{type:'integer',enum:[0,1,2]},form:{type:'integer',enum:[0,1]},
      parameter:{type:'integer',minimum:0,maximum:7},order:{type:'array',minItems:4,maxItems:4,
        items:{type:'integer',enum:[0,1,2,3]}}}};
  const format = {type:'object',additionalProperties:false,required:['plans'],
    properties:{plans:{type:'array',minItems:ids.length,maxItems:ids.length,items:item}}};
  try {
    const reply = await fetch(ollama + '/api/generate', {
      method:'POST', headers:{'Content-Type':'application/json'}, signal:AbortSignal.timeout(160_000),
      body:JSON.stringify({model, stream:false, format, options:{temperature:0.5,num_predict:2800},
        prompt:'你是台灣建築師考試練習題的編題助理。依題目選擇題幹 form（0 到 1）、情境 setting（0 到 2）、口吻 style（0 情境、1 案例討論、2 單選判斷），以及四個選項索引順序 order（0 到 3，每個值恰好一次）。parameter 是該題 parameters 陣列的索引，只有一項時固定用 0。每個 id 恰好出現一次。請只輸出符合 JSON schema 的內容。\n' + JSON.stringify(choices)}),
    });
    if (!reply.ok) throw Error('模型未能產生題目。請確認 Ollama 的模型可以正常執行。');
    const output = await reply.json();
    const {plans} = JSON.parse(output.response);
    const valid = Array.isArray(plans) && plans.length === ids.length &&
      new Set(plans.map(p => p?.id)).size === ids.length && plans.every(p =>
        p && ids.includes(p.id) && [0,1,2].includes(p.setting) && [0,1,2].includes(p.style) && [0,1].includes(p.form) &&
        Number.isInteger(p.parameter) && p.parameter >= 0 && p.parameter < choices.find(c => c.id === p.id).parameters.length &&
        Array.isArray(p.order) && p.order.length === 4 && p.order.every(n => Number.isInteger(n)) &&
        [...p.order].sort().join('') === '0123');
    if (!valid) return json(response,422,{error:'模型結果未通過檢查，請再試一次或先做已核對的情境題。'});
    return json(response,200,{plans});
  } catch (error) {
    const message = error.name === 'TimeoutError' ? '本機模型出題逾時。可先試一題。' :
      '本機模型沒有回傳可用的出題結果。請重試或先做已核對的情境題。';
    return json(response,502,{error:message});
  }
}

function serve(request, response, name) {
  let file;
  if (papers.has(name)) file = path.join(root, '..', name);
  else if (appFiles.has(name) || /^pages\/(law|build)-\d{2,3}\/\d{1,2}\.webp$/.test(name)) file = path.join(root,name);
  else return json(response,404,{error:'找不到檔案。'});
  const stat = fs.statSync(file,{throwIfNoEntry:false});
  if (!stat?.isFile()) return json(response,404,{error:'找不到檔案。'});
  response.writeHead(200, {
    'Content-Type':mime[path.extname(file)], 'Content-Length':stat.size,
    'Cache-Control':name.endsWith('.webp') ? 'private, max-age=86400' : 'no-cache',
    'X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'",
  });
  if (request.method === 'HEAD') response.end();
  else fs.createReadStream(file).on('error', () => response.destroy()).pipe(response);
}

http.createServer(async (request,response) => {
  try {
    if (request.headers.host !== host) return json(response,403,{error:'請使用本機網址。'});
    const url = new URL(request.url,'http://' + host);
    const name = decodeURIComponent(url.pathname.slice(1)) || '開始測驗.html';
    if (request.method === 'GET' && name === 'api/models') {
      try { return json(response,200,await modelNames()); }
      catch { return json(response,503,{error:'找不到本機 Ollama。'}); }
    }
    if (request.method === 'POST' && name === 'api/generate') return await generate(request,response);
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(response,405,{error:'不支援的操作。'});
    return serve(request,response,name);
  } catch {
    if (!response.headersSent) json(response,400,{error:'無法處理這個要求。'});
    else response.destroy();
  }
}).listen(port,'127.0.0.1',() => console.log(`Architect quiz: http://${host}/`));
