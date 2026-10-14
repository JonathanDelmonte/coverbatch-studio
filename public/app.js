const $ = id => document.getElementById(id);
const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = v => structuredClone(v);
const prettySize = n => n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`;
const availLabel = v => ({ immediate: 'Envio imediato', preorder: 'Pré-venda', other: 'Outra' }[v] || 'Não confirmada');
let state, currentKey, draft, individual = false, page = 'import', limit = 60, lastJob, previewSeq = 0, previewOK = false;
let modelTimer, previewTimer, toastTimer, modelDirty = false;
let quickKeys = [];

function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6000); }
async function api(url, method = 'GET', data) {
  const options = { method, headers: {} };
  if (method !== 'GET') options.headers['x-local-token'] = state?.token || '';
  if (data instanceof FormData) options.body = data;
  else if (data !== undefined) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(data); }
  const response = await fetch(url, options); const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Falha na operação local.'); return result;
}
async function safe(fn) { try { await fn(); } catch (e) { toast(e.message); $('saveStatus').textContent = 'Falha'; } }
const current = () => state.products.find(p => p.key === currentKey);
const asset = id => state.assets.find(a => a.id === id);
const assetURL = id => `/api/assets/${encodeURIComponent(id)}`;
const selected = () => state.products.filter(p => p.selected);
const templateOf = p => state.templates.find(t => t.id === p?.templateId);
function effectiveFrame(p) { return { ratio: 'original', width: 0, height: 0, fit: 'contain', background: '#ffffff', focusX: .5, focusY: .5, cropConfirmed: false, ...templateOf(p)?.frame, ...p?.override?.frame }; }

async function refresh({ keepDraft = false } = {}) {
  state = await api('/api/state');
  if (!currentKey) currentKey = state.products.find(p => p.baseId)?.key;
  if (!keepDraft) { const preferred = state.templates.find(t => t.id === draft?.id) || templateOf(current()) || state.templates.find(t => t.platform === current()?.platform) || state.templates[0]; draft = preferred ? clone(preferred) : null; modelDirty = false; }
  renderProfile(); renderReport(); renderList(); renderPicker(); renderInspector(); renderSummary(); setPrefs();
}
function renderProfile() {
  const p = state.profile;
  $('appTitle').textContent = p?.title || 'Criador de capas para loja virtual'; document.title = $('appTitle').textContent;
  $('developerName').textContent = p?.developer || 'ZIRTUNO';
  $('developerLogo').hidden = !p?.hasDeveloperLogo;
  if (p?.hasDeveloperLogo) $('developerLogo').src = '/api/profile/developer-logo.svg';
  $('compositionReference').hidden = !p?.hasReference; $('compositionPlaceholder').hidden = !!p?.hasReference;
  if (p?.hasReference) $('compositionReference').src = '/api/profile/reference.jpg';
  $('presetStatus').textContent = p ? 'PS4, PS5 e logo já preparados. Substitua apenas se precisar.' : 'Carregue seus PNGs para criar os modelos.';
  const findRole = (t, role) => t.layers.find(l => l.role === role) || t.layers[role === 'banner' ? 0 : 1];
  $('bannerSamples').innerHTML = ['PS4','PS5'].map(platform => {
    const t = state.templates.find(t => t.platform === platform), l = t && findRole(t, 'banner');
    return `<div><span>${platform}</span>${l ? `<img src="${assetURL(l.assetId)}" alt="Faixa ${platform}">` : '<small>Aguardando PNG</small>'}</div>`;
  }).join('');
  const t = state.templates.find(t => findRole(t, 'logo')), l = t && findRole(t, 'logo');
  $('logoSamples').innerHTML = l ? `<div class="logo-sample"><img src="${assetURL(l.assetId)}" alt="Logo da loja"><span>Mesma logo nos dois modelos</span></div>` : '<small>Aguardando PNG da logo</small>';
}
function showPage(next) { page = next; document.querySelectorAll('.page').forEach(p => p.hidden = p.id !== `page-${next}`); document.querySelectorAll('nav [data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === next)); if (next === 'edit') requestPreview(); renderSummary(); }
document.querySelectorAll('[data-page]').forEach(b => b.onclick = () => showPage(b.dataset.page));

function renderReport() {
  const r = state.importReport;
  $('importReport').innerHTML = r ? `<div class="stats"><div><b>${r.totalProducts}</b><span>produtos reconhecidos</span></div><div><b>${r.previewAssets}</b><span>capas da prévia</span></div><div><b>${r.withPreview}</b><span>produtos com capa da prévia</span></div><div><b>${r.withoutPreview}</b><span>sem capa da prévia</span></div><div><b>${r.withoutImage}</b><span>sem nenhuma imagem</span></div></div>${r.errors?.length || r.warnings?.length ? `<details class="report-issues"><summary>${r.errors.length} falhas e ${r.warnings.length} avisos de importação</summary>${r.errors.map(e => `<p>${escape(e.file)}: ${escape(e.error)}</p>`).join('')}${r.warnings.map(e => `<p>${escape(e)}</p>`).join('')}</details>` : ''}` : '';
  const layers = state.assets.filter(a => a.kind === 'layer');
  const opaqueCount = layers.filter(a => a.opaqueAccepted).length;
  $('layerStatus').textContent = state.profile ? 'Faixas PS4/PS5 e logo prontas. Confira as capas com o padrão da referência ou ajuste na próxima etapa.' : layers.length ? `${layers.length} PNGs disponíveis${opaqueCount ? ` · ${opaqueCount} opaco(s), com fundo preservado` : ' com transparência'}. Configure a composição na próxima etapa.` : 'Carregue seus PNGs originais da faixa e da logo.';
  const refs = state.assets.filter(a => a.kind === 'reference');
  $('referencesSection').hidden = !refs.length;
  $('references').innerHTML = refs.map(a => `<figure><img src="${assetURL(a.id)}" alt="Referência visual"><figcaption>${escape(a.name.split('/').at(-1))}</figcaption></figure>`).join('');
}
function filtered() {
  const q = $('search').value.toLocaleLowerCase(), platform = $('platformFilter').value, status = $('statusFilter').value;
  return state.products.filter(p => (!q || `${p.name} ${p.slug} ${p.id}`.toLocaleLowerCase().includes(q)) && (!platform || p.platform === platform) && (!status || ({ base: !!p.baseId, missing: !p.baseId, selected: p.selected, pending: !!state.readiness[p.key], ready: !state.readiness[p.key] }[status])));
}
function renderList() {
  const list = filtered(); $('productCount').textContent = `${list.length} / ${state.products.length}`;
  $('selectionCount').textContent = selected().length ? `${selected().length} produtos selecionados` : 'Nenhum produto selecionado';
  $('products').innerHTML = list.slice(0, limit).map(p => {
    const a = asset(p.baseId), ready = !state.readiness[p.key];
    return `<div class="product-row ${p.key === currentKey ? 'active' : ''}" data-key="${escape(p.key)}"><input type="checkbox" data-select="${escape(p.key)}" ${p.selected ? 'checked' : ''} aria-label="Selecionar ${escape(p.name)}">${a && !a.error ? `<img src="${assetURL(a.id)}" alt="" loading="lazy">` : '<span class="thumb-empty">—</span>'}<div class="product-text"><strong>${escape(p.name)}</strong><small>${escape(p.platform || 'Defina plataforma')} · <span class="${ready ? 'state-ready' : 'state-pending'}">${ready ? 'Pronto' : !a ? 'Sem capa' : a.error ? 'Inválida' : !p.baseApproved ? 'Aprovar base' : 'Pendente'}</span></small></div></div>`;
  }).join('') || '<p class="hint">Nenhum produto neste filtro.</p>';
  $('moreProducts').hidden = list.length <= limit;
  document.querySelectorAll('[data-select]').forEach(input => { input.onclick = e => e.stopPropagation(); input.onchange = () => safe(async () => { await patchProducts([input.dataset.select], { selected: input.checked }); }); });
  document.querySelectorAll('.product-row').forEach(row => row.onclick = () => { currentKey = row.dataset.key; renderList(); renderInspector(); requestPreview(); });
}
for (const id of ['search', 'platformFilter', 'statusFilter']) $(id).oninput = () => { limit = 60; renderList(); };
$('moreProducts').onclick = () => { limit += 60; renderList(); };
$('selectVisible').onclick = () => safe(async () => { await patchProducts(filtered().map(p => p.key), { selected: true }); });
$('clearSelection').onclick = () => safe(async () => { await patchProducts(selected().map(p => p.key), { selected: false }); });

async function patchProducts(keys, changes, redraw = true) {
  $('saveStatus').textContent = 'Salvando…'; const r = await api('/api/products', 'PATCH', { keys, changes });
  if (r.skipped.length) toast(`${r.skipped.length} item(ns) não alterado(s): ${r.skipped[0].error}`);
  state = await api('/api/state'); $('saveStatus').textContent = 'Salvo';
  renderList(); renderSummary();
  if (redraw) { renderInspector(); requestPreview(); }
}

async function importInput(files) {
  if (!files.length) return; const form = new FormData(); Array.from(files).forEach(f => form.append('files', f));
  $('importProgress').hidden = false; $('importProgress').removeAttribute('value'); $('inputFiles').disabled = true;
  try {
    $('importStatus').textContent = 'Copiando arquivos para o processamento local…';
    const { id } = await api('/api/import', 'POST', form);
    let report;
    do { report = await api(`/api/import/${id}`); $('importStatus').textContent = `${report.phase || 'Lendo pacote'} · ${report.processed || 0} arquivos`; if (!report.complete) await new Promise(r => setTimeout(r, 800)); } while (!report.complete);
    if (report.error) throw new Error(report.error);
    await refresh(); $('importStatus').textContent = `Importação concluída: ${report.totalProducts} produtos, ${report.errors.length} falhas por arquivo.`;
    quickKeys = report.manualProductKeys || []; $('quickSetup').hidden = !quickKeys.length; $('quickAvailability').checked = false;
    if (quickKeys.length) { currentKey = quickKeys[0]; $('quickSetupTitle').textContent = `${quickKeys.length} capa(s) para preparar`; renderList(); renderInspector(); }
    toast(quickKeys.length ? 'Escolha a plataforma abaixo para usar o padrão.' : 'Material importado. Continue em Configurar e revisar.');
  } finally { $('importProgress').hidden = true; $('inputFiles').disabled = false; $('inputFiles').value = ''; }
}
$('inputFiles').onchange = e => safe(() => importInput(e.target.files));
function bindDrop(zoneId, inputId, receive) {
  const zone = $(zoneId), input = $(inputId);
  zone.onkeydown = e => { if (['Enter',' '].includes(e.key)) { e.preventDefault(); input.click(); } };
  zone.ondragover = e => { e.preventDefault(); zone.classList.add('dragging'); };
  zone.ondragleave = () => zone.classList.remove('dragging');
  zone.ondrop = e => { e.preventDefault(); zone.classList.remove('dragging'); safe(() => receive(e.dataTransfer.files)); };
}
bindDrop('dropzone', 'inputFiles', importInput);
$('quickApply').onclick = () => safe(async () => {
  const platform = $('quickPlatform').value;
  if (platform === 'both') {
    if (!$('quickAvailability').checked) throw new Error('Confirme envio imediato para usar estas faixas.');
    const r=await api('/api/manual-variants','POST',{keys:quickKeys,availabilityConfirmed:true});
    if(!r.keys.length)throw new Error('Nenhuma capa válida para gerar as duas versões.');
    await refresh();currentKey=r.keys[0];draft=clone(templateOf(current()));individual=true;renderList();renderPicker();renderInspector();showPage('edit');
    toast(`${r.keys.length} versões avulsas preparadas. Confira cada prévia. Os IDs são locais até você informar os IDs reais.`);return;
  }
  const t = state.templates.find(t => t.platform === platform && t.availability === 'immediate');
  if (!t || t.layers.length < 2) throw new Error(`Carregue a faixa ${platform} e a logo para preparar este modelo.`);
  if (!$('quickAvailability').checked) throw new Error('Confirme envio imediato para usar esta faixa. Para outra disponibilidade, configure um modelo com o PNG correspondente.');
  await patchProducts(quickKeys, {platform, templateId:t.id, availability:t.availability, selected:true, override:{}}, false);
  draft = clone(t); currentKey = quickKeys[0]; individual = true; renderList(); renderPicker(); renderInspector(); showPage('edit');
});
async function uploadRole(files, role) {
  if (!files.length) return;
  if (files.length !== 1) throw new Error('Coloque um PNG por vez nesta área. Escolha PS4 ou PS5 para a faixa.');
  await flushModel();
  const form = new FormData(); form.append('files', files[0]); form.append('role',role); form.append('allowOpaque',String($('allowOpaqueLayers').checked));
  const r = await api('/api/layers','POST',form); if (r.errors.length) throw new Error(r.errors.join(' · '));
  const a = r.added[0], platforms = role === 'logo' ? ['PS4','PS5'] : [$('bannerPlatform').value];
  for (const platform of platforms) {
    let t = state.templates.find(t => t.platform === platform && t.availability === 'immediate');
    t = t ? clone(t) : {id:crypto.randomUUID(), name:`${platform} — Envio imediato`, platform, availability:'immediate', frame:effectiveFrame(null), layers:[]};
    const slot = t.layers.findIndex(l => l.role === role || (!l.role && l.anchor === (role==='logo'?'bottom-right':'bottom-left')));
    const layer = {role,assetId:a.id,anchor:role==='logo'?'bottom-right':'bottom-left',width:role==='logo'?.145:.545833,marginX:role==='logo'?.026667:.058333,marginY:role==='logo'?.046667:.035333,opacity:1};
    if (slot < 0) t.layers.push(layer); else t.layers[slot] = {...t.layers[slot],assetId:a.id,role,trimTop:0,rounding:0};
    // Share a logo already loaded in the other platform's model.
    if (role === 'banner' && !t.layers.some(l=>l.role==='logo')) { const logo = state.templates.flatMap(t=>t.layers).find(l=>l.role==='logo'); if(logo)t.layers.push(clone(logo)); }
    await api(`/api/templates/${t.id}`,'PUT',t);
    const index=state.templates.findIndex(x=>x.id===t.id);if(index<0)state.templates.push(t);else state.templates[index]=t;
  }
  await refresh(); toast(role==='logo'?'Logo atualizada nos modelos PS4 e PS5. Confira novamente as prévias.':`Faixa ${platforms[0]} atualizada. Confira novamente as prévias.`);
}
for (const role of ['banner','logo']) { $(role+'Files').onchange=e=>safe(async()=>{await uploadRole(e.target.files,role);e.target.value='';}); bindDrop(role+'Dropzone',role+'Files',files=>uploadRole(files,role)); }
for (const id of ['layerFilesImport', 'layerFiles']) $(id).onchange = e => safe(async () => {
  const form = new FormData(); Array.from(e.target.files).forEach(f => form.append('files', f));
  form.append('allowOpaque', String($('allowOpaqueLayers').checked));
  const r = await api('/api/layers', 'POST', form); await refresh({ keepDraft: true }); renderProfile();
  const opaque = r.added.filter(a => a.opaqueAccepted).length;
  toast(r.errors.length ? r.errors.join(' · ') : `${r.added.length} PNG(s) carregado(s).${opaque ? ` ${opaque} opaco(s): fundo original preservado.` : ''}`); e.target.value = '';
});
for (const id of ['allowOpaqueLayers', 'allowOpaqueLayersModel']) $(id).onchange = e => safe(async () => {
  for (const target of ['allowOpaqueLayers', 'allowOpaqueLayersModel']) $(target).checked = e.target.checked;
  const preferences = { allowOpaqueLayers: e.target.checked };
  await api('/api/preferences', 'PUT', preferences); Object.assign(state.preferences, preferences);
});

function renderPicker() {
  $('templateSelect').innerHTML = '<option value="">Escolha um modelo</option>' + state.templates.map(t => `<option value="${escape(t.id)}">${escape(t.name)}</option>`).join('');
  $('templateSelect').value = draft?.id || '';
}
function frameHTML(f, target) {
  const options = [['original','Preservar original'],['4:5','4:5'],['3:4','3:4'],['1:1','Quadrado 1:1'],['custom','Personalizado']];
  return `<div class="frame-fields" data-frame-target="${target}"><label>Proporção<select data-frame="ratio">${options.map(([v,l]) => `<option value="${v}" ${f.ratio === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label><div class="form-row"><label>Largura (px)<input type="number" data-frame="width" min="0" max="6000" value="${Number(f.width)||0}"><small>0 = largura original</small></label>${f.ratio === 'custom' ? `<label>Altura (px)<input type="number" data-frame="height" min="1" max="6000" value="${Number(f.height)||500}"></label>` : ''}</div>${f.ratio !== 'original' ? `<label>Enquadramento<select data-frame="fit"><option value="contain" ${f.fit==='contain'?'selected':''}>Arte inteira + preenchimento</option><option value="cover" ${f.fit==='cover'?'selected':''}>Recorte explícito</option></select></label><label>Cor de preenchimento<input type="color" data-frame="background" value="${escape(f.background)}"></label>${f.fit === 'cover' ? `<label>Foco horizontal <output>${Math.round(f.focusX*100)}%</output><input type="range" data-frame="focusX" min="0" max="100" value="${f.focusX*100}"></label><label>Foco vertical <output>${Math.round(f.focusY*100)}%</output><input type="range" data-frame="focusY" min="0" max="100" value="${f.focusY*100}"></label><p class="hint">Recorte ativo. Confira os logotipos e confirme este recorte individualmente.</p>${target==='individual' ? `<label><input type="checkbox" data-frame="cropConfirmed" ${f.cropConfirmed?'checked':''}> Conferi e aprovo este recorte</label>` : ''}` : '<p class="hint">A arte permanece inteira, sem esticar. O preenchimento aparece na prévia.</p>'}` : '<p class="hint">Proporção e resolução originais preservadas. Reduções são permitidas; ampliações da arte são bloqueadas.</p>'}</div>`;
}
function layersHTML(layers, target) {
  return layers.map((l, i) => { const a = asset(l.assetId); return `<details class="layer" open><summary><img src="${assetURL(l.assetId)}" alt=""><span>${escape(l.role==='banner'?'Faixa · esquerda':l.role==='logo'?'Logo · direita':a?.name||'PNG ausente')}</span></summary><div class="layer-controls" data-layer-index="${i}" data-layer-target="${target}"><label>Âncora<select data-layer="anchor">${[['bottom-left','Inferior esquerda'],['bottom-right','Inferior direita'],['top-left','Superior esquerda'],['top-right','Superior direita'],['center','Centro']].map(([v,t]) => `<option value="${v}" ${l.anchor===v?'selected':''}>${t}</option>`).join('')}</select></label>${[['width','Largura do quadro',1,100],['marginX','Margem horizontal',0,50],['marginY','Margem vertical',0,50],['opacity','Opacidade',0,100]].map(([k,label,min,max]) => `<label>${label}<output>${(l[k]*100).toFixed(1)}%</output><input type="range" data-layer="${k}" min="${min}" max="${max}" step="0.1" value="${l[k]*100}"></label>`).join('')}<details class="layer-advanced"><summary>Acabamento do PNG</summary><label>Ignorar margem superior do PNG (px)<input type="number" data-layer="trimTop" min="0" max="${Math.max(0,(a?.height||1)-1)}" value="${l.trimTop||0}"></label><label>Cantos arredondados<output>${((l.rounding||0)*100).toFixed(1)}%</output><input type="range" data-layer="rounding" min="0" max="50" step=".1" value="${(l.rounding||0)*100}"></label><small>Afeta só a camada. O arquivo original e a capa permanecem intactos.</small></details><small>${a?.width} × ${a?.height} px · proporção preservada${a?.opaqueAccepted ? " · PNG opaco: fundo mantido" : " · transparência preservada"}</small><div class="layer-actions"><button data-layer-move="${i}" data-target="${target}">Subir camada</button><button data-layer-remove="${i}" data-target="${target}" class="danger subtle">Remover</button></div></div></details>`; }).join('');
}
function renderInspector() {
  $('tabModel').classList.toggle('active', !individual); $('tabIndividual').classList.toggle('active', individual);
  $('modelEditor').hidden = individual; $('individualEditor').hidden = !individual;
  $('modelFields').hidden = !draft; $('modelEmpty').hidden = !!draft;
  if (draft) {
    $('templateName').value = draft.name; $('templatePlatform').value = draft.platform; $('templateAvailability').value = draft.availability;
    $('layers').innerHTML = layersHTML(draft.layers, 'model'); $('modelFrame').innerHTML = frameHTML(draft.frame || effectiveFrame(null), 'model');
    const pngs = state.assets.filter(a => a.kind === 'layer'); $('assetSelect').innerHTML = pngs.length ? pngs.map(a => `<option value="${a.id}">${escape(a.name)}</option>`).join('') : '<option value="">Carregue um PNG primeiro</option>';
  }
  const preset = state.profile?.defaultTemplates?.find(t=>t.id===draft?.id);
  $('restorePreset').hidden = !preset;
  $('presetGeometry').textContent = preset ? 'Padrão da referência: faixa à esquerda e logo à direita, com medidas proporcionais. A capa mantém a proporção original.' : '';
  const p = current();
  if (p) {
    const a = asset(p.baseId), t = templateOf(p);
    const choices = [...new Set([...(p.baseChoices || []), ...state.assets.filter(a => a.kind === 'manual').map(a => a.id)])].map(asset).filter(Boolean);
    $('individualFields').innerHTML = `<h3>Arte base</h3><label>Arquivo<select id="baseSelect"><option value="">Sem capa</option>${choices.map(a => `<option value="${a.id}" ${a.id===p.baseId?'selected':''}>${escape(a.name)}${a.kind==='published'?' · publicada':''}</option>`).join('')}</select></label>${a ? `<div class="source-info"><b>${escape(a.origin)}</b><br>${escape(a.source || '')}<br>${a.width || '?'} × ${a.height || '?'} px · ${prettySize(a.bytes)}<br>SHA-256: ${escape(a.sha256)}${a.error?`<br>Erro: ${escape(a.error)}`:''}</div><label><input id="approveBase" type="checkbox" ${p.baseApproved?'checked':''} ${a.error?'disabled':''}> Avaliei e aprovo esta imagem como base</label>` : '<p class="notice">Não há arte disponível para este produto. Importe a capa correta e selecione-a acima.</p>'}<h3>Modelo e disponibilidade</h3><label>Plataforma do produto<select id="individualPlatform"><option value="">Escolha</option>${[...new Set(['PS4','PS5',p.platform].filter(Boolean))].map(v=>`<option ${p.platform===v?'selected':''}>${escape(v)}</option>`).join('')}</select></label><label>Modelo<select id="productTemplate"><option value="">Sem modelo</option>${state.templates.filter(t => t.platform===p.platform).map(t => `<option value="${t.id}" ${p.templateId===t.id?'selected':''}>${escape(t.name)}</option>`).join('')}</select></label><label><input id="confirmProductAvailability" type="checkbox" ${p.availability && p.availability===t?.availability?'checked':''} ${!t?.availability?'disabled':''}> Confirmo: ${escape(availLabel(t?.availability))}</label><h3>Enquadramento individual</h3>${frameHTML(effectiveFrame(p), 'individual')}${t ? `<h3>Camadas individuais</h3>${p.override?.layers ? layersHTML(p.override.layers,'individual') : '<button id="unlockLayers" class="full">Ajustar camadas só neste produto</button>'}` : ''}<button id="resetOverride" class="subtle full">Restaurar ajustes do modelo</button><details class="individual-identity"><summary>Identificação do produto</summary>${[['id','ID'],['slug','Slug'],['name','Nome'],['platform','Plataforma']].map(([k,l])=>`<label>${l}<input data-identity="${k}" value="${escape(p[k])}"></label>`).join('')}<p class="hint">Use a identificação real para relacionar a imagem ao produto correto.</p></details><h3>Selecionado no lote</h3><label><input id="includeProduct" type="checkbox" ${p.selected?'checked':''}> Incluir este produto na exportação</label>`;
    $('baseSelect').onchange = e => safe(() => patchProducts([p.key], { baseId: e.target.value || null, baseApproved: false }));
    if ($('approveBase')) $('approveBase').onchange = e => safe(() => patchProducts([p.key], { baseApproved: e.target.checked }));
    $('individualPlatform').onchange = e => safe(async()=>{ const platform=e.target.value; await patchProducts([p.key],{platform,templateId:null,availability:null,override:{}}); });
    $('productTemplate').onchange = e => safe(() => patchProducts([p.key], { templateId: e.target.value || null, availability: null, override: {} }));
    $('confirmProductAvailability').onchange = e => safe(() => patchProducts([p.key], { availability: e.target.checked ? t.availability : null }));
    $('includeProduct').onchange = e => safe(() => patchProducts([p.key], { selected: e.target.checked }));
    if ($('unlockLayers')) $('unlockLayers').onclick = () => safe(() => patchProducts([p.key], { override: { ...p.override, layers: clone(t.layers) } }));
    $('resetOverride').onclick = () => safe(() => patchProducts([p.key], { override: {} }));
    document.querySelectorAll('[data-identity]').forEach(input => input.onchange = () => safe(() => patchProducts([p.key], { [input.dataset.identity]: input.value })));
  } else $('individualFields').innerHTML = '<p class="hint">Selecione um produto.</p>';
  bindControls();
}
$('restorePreset').onclick = () => safe(async()=>{ const preset=state.profile?.defaultTemplates?.find(t=>t.id===draft?.id); if(!preset)return; draft=clone(preset); modelDirty=true; await flushModel(); renderInspector(); requestPreview(); toast('Posição e tamanho da referência restaurados.'); });
$('tabModel').onclick = () => { individual = false; renderInspector(); requestPreview(); };
$('tabIndividual').onclick = () => { individual = true; renderInspector(); requestPreview(); };
$('templateSelect').onchange = e => safe(async () => { await flushModel(); draft = clone(state.templates.find(t => t.id===e.target.value) || null); $('confirmAvailability').checked = false; renderInspector(); requestPreview(); });
async function saveModel() {
  if (!draft || !modelDirty) return; const snapshot = clone(draft); modelDirty = false; $('saveStatus').textContent = 'Salvando…';
  await api(`/api/templates/${snapshot.id}`, 'PUT', snapshot);
  const i = state.templates.findIndex(t => t.id===snapshot.id); if (i<0) state.templates.push(snapshot); else state.templates[i] = snapshot;
  // Changing any model invalidates reviews of every product using it.
  for (const p of state.products.filter(p => p.templateId===snapshot.id)) { p.reviewed=false; state.readiness[p.key]='Confira a prévia e marque o produto como revisado.'; }
  $('saveStatus').textContent = 'Salvo'; renderPicker(); renderList(); renderSummary(); renderProfile();
}
function scheduleModel() { modelDirty = true; $('saveStatus').textContent = 'Alterando…'; clearTimeout(modelTimer); modelTimer = setTimeout(() => safe(saveModel), 400); requestPreview(); }
async function flushModel() { clearTimeout(modelTimer); await saveModel(); }
$('newTemplate').onclick = () => safe(async () => {
  await flushModel(); draft = { id: crypto.randomUUID(), name: `Novo modelo ${state.templates.length+1}`, platform: current()?.platform || 'PS5', availability: '', layers: [], frame: { ratio:'original', width:0, height:0, fit:'contain', background:'#ffffff', focusX:.5, focusY:.5, cropConfirmed:false } };
  modelDirty = true; await saveModel(); $('confirmAvailability').checked=false; renderInspector();
});
$('cloneTemplate').onclick = () => safe(async () => { if (!draft) return; await flushModel(); draft = { ...clone(draft), id: crypto.randomUUID(), name: `${draft.name} (cópia)` }; modelDirty = true; await saveModel(); renderInspector(); });
for (const [id,k] of [['templateName','name'],['templatePlatform','platform'],['templateAvailability','availability']]) $(id).oninput = e => { draft[k]=e.target.value; $('confirmAvailability').checked=false; scheduleModel(); };
$('addLayer').onclick = () => { const id=$('assetSelect').value; if(!id||!draft)return; draft.layers.push({ assetId:id, anchor: draft.layers.length===0?'bottom-left':'bottom-right', width:draft.layers.length===0?.55:.14, marginX:.04, marginY:.035, opacity:1 }); renderInspector(); scheduleModel(); };
$('deleteTemplate').onclick = () => safe(async () => { if(!draft)return; clearTimeout(modelTimer); await api(`/api/templates/${draft.id}`, 'DELETE'); draft=null; await refresh(); requestPreview(); });
$('applyTemplate').onclick = () => safe(async () => {
  if(!draft)return; if(!$('confirmAvailability').checked || !draft.availability) throw new Error('Escolha e confirme a disponibilidade antes de aplicar.');
  if(draft.layers.length<2) throw new Error('Carregue e adicione pelo menos a faixa e a logo.');
  await flushModel(); const group=$('applyGroup').value;
  const candidates=group==='current'?(current()?[current()]:[]):group==='platform'?state.products:selected();
  const compatible=candidates.filter(p=>p.platform===draft.platform);
  if(!compatible.length) throw new Error('Nenhum produto compatível neste grupo.');
  await patchProducts(compatible.map(p=>p.key),{templateId:draft.id,availability:draft.availability,override:{}});
  toast(`Modelo aplicado a ${compatible.length} produtos de ${draft.platform}. ${candidates.length-compatible.length} incompatíveis ignorados. Confira as prévias.`);
});

function bindControls() {
  document.querySelectorAll('[data-frame]').forEach(input => {
    input.oninput = async () => {
      const target = input.closest('[data-frame-target]').dataset.frameTarget, key=input.dataset.frame;
      let value=input.type==='checkbox'?input.checked:['width','height'].includes(key)?Number(input.value):['focusX','focusY'].includes(key)?Number(input.value)/100:input.value;
      const f=target==='model'?draft.frame:effectiveFrame(current()); f[key]=value;
      if(key==='ratio' && value==='custom') { f.width=f.width||400; f.height=f.height||500; }
      if(key!=='cropConfirmed') f.cropConfirmed=false;
      if(input.previousElementSibling?.tagName==='OUTPUT')input.previousElementSibling.textContent=`${input.value}%`;
      if(target==='model'){ draft.frame=f; scheduleModel(); if(['ratio','fit'].includes(key))renderInspector(); }
      else { const p=current(); p.override={...p.override,frame:f}; p.reviewed=false; requestPreview(); }
    };
    if(input.closest('[data-frame-target]').dataset.frameTarget==='individual')input.onchange=()=>safe(async()=>{await patchProducts([currentKey],{override:clone(current().override)},false); if(['ratio','fit'].includes(input.dataset.frame))renderInspector(); requestPreview();});
  });
  document.querySelectorAll('[data-layer]').forEach(input => {
    input.oninput=()=>{
      const box=input.closest('[data-layer-index]'),target=box.dataset.layerTarget,i=Number(box.dataset.layerIndex),key=input.dataset.layer;
      const layers=target==='model'?draft.layers:current().override.layers;
      layers[i][key]=key==='anchor'?input.value:key==='trimTop'?Number(input.value):Number(input.value)/100;
      if(input.previousElementSibling?.tagName==='OUTPUT') input.previousElementSibling.textContent=`${Number(input.value).toFixed(1)}%`;
      if(target==='model')scheduleModel();else{current().reviewed=false;requestPreview();}
    };
    if(input.closest('[data-layer-index]').dataset.layerTarget==='individual')input.onchange=()=>safe(()=>patchProducts([currentKey],{override:clone(current().override)},false));
  });
  document.querySelectorAll('[data-layer-remove],[data-layer-move]').forEach(button=>button.onclick=()=>safe(async()=>{
    const target=button.dataset.target,layers=target==='model'?draft.layers:current().override.layers;
    if(button.dataset.layerRemove!==undefined)layers.splice(Number(button.dataset.layerRemove),1);else{const i=Number(button.dataset.layerMove);if(i>0)[layers[i-1],layers[i]]=[layers[i],layers[i-1]];}
    if(target==='model')scheduleModel();else await patchProducts([currentKey],{override:clone(current().override)},false);
    renderInspector();requestPreview();
  }));
}

function requestPreview() { previewSeq++; previewOK=false; $('reviewed').disabled=true; const p=current(); $('previewTitle').textContent=p?.name||'Selecione uma capa'; $('previewPlatform').textContent=p?`${p.platform||'Plataforma não definida'} · ID ${p.id}`:'PRÉVIA'; $('previewInfo').textContent=p?'Preparando prévia…':''; clearTimeout(previewTimer); previewTimer=setTimeout(()=>safe(renderPreview),250); }
async function renderPreview() {
  const seq=++previewSeq,p=current(); previewOK=false;
  $('previewTitle').textContent=p?.name||'Selecione uma capa'; $('previewPlatform').textContent=p?`${p.platform||'Plataforma não definida'} · ID ${p.id}`:'PRÉVIA';
  $('reviewActions').hidden=!p; $('reviewed').checked=!!p?.reviewed; $('reviewed').disabled=true;
  $('previewWarnings').hidden=true;
  const a=asset(p?.baseId); $('previewEmpty').hidden=!!a; $('resultFigure').hidden=!a; $('originalFigure').hidden=!a||!$('compare').checked;
  if(!a){$('previewInfo').textContent=p?'Sem capa. Forneça uma arte correta para este produto.':'';return;}
  $('originalImg').src=assetURL(a.id); $('previewInfo').textContent='Preparando prévia…';
  const previewTemplate=!individual&&draft ? draft : undefined;
  if(previewTemplate && previewTemplate.platform!==p.platform){$('resultFigure').hidden=true;$('previewInfo').textContent=`Este modelo é de ${previewTemplate.platform}. Selecione um produto compatível ou vá a “Só este produto” para ver o modelo aplicado.`;return;}
  try {
    const r=await api('/api/preview','POST',{key:p.key,template:previewTemplate,override:previewTemplate?{}:p.override,preferences:readPrefs()});
    if(seq!==previewSeq)return;
    $('resultImg').src=r.image;$('resultFigure').hidden=false;
    $('previewInfo').textContent=`${r.width} × ${r.height} px · ${prettySize(r.bytes)} · ${readPrefs().format==='png'?'PNG sem perdas':`JPEG · qualidade ${r.quality}`} · ${a.origin}`;
    const warnings=[...r.warnings,...(r.pending?[r.pending]:[])];
    if(!individual && draft && p.templateId!==draft.id)warnings.push('Prévia do modelo em edição. Aplique-o a este produto antes de revisar para exportação.');
    $('previewWarnings').hidden=!warnings.length;$('previewWarnings').textContent=warnings.join(' ');
    if(previewTemplate && Object.keys(p.override||{}).length)warnings.push('Este produto tem ajustes individuais. Revise o resultado em “Só este produto”.');
    $('previewWarnings').hidden=!warnings.length;$('previewWarnings').textContent=warnings.join(' ');
    previewOK=!r.pending && p.baseApproved && (!previewTemplate||(p.templateId===previewTemplate.id&&!Object.keys(p.override||{}).length));
    const reason=state.readiness[p.key];
    $('reviewed').disabled=!previewOK || (!!reason && !reason.startsWith('Confira a prévia'));
  }catch(e){if(seq!==previewSeq)return;$('resultFigure').hidden=true;$('previewInfo').textContent=`Prévia pendente: ${e.message}`;}
}
$('compare').onchange=()=>requestPreview();
$('zoom').oninput=e=>{document.documentElement.style.setProperty('--zoom',Number(e.target.value)/100);$('zoomValue').textContent=`${e.target.value}%`;};
$('refreshPreview').onclick=()=>requestPreview();
$('reviewed').onchange=e=>safe(async()=>{if(e.target.checked&&!previewOK)throw new Error('Confira uma prévia válida primeiro.');await patchProducts([currentKey],{reviewed:e.target.checked},false);});

function readPrefs(){return{format:$('format').value,quality:Number($('quality').value),minQuality:Number($('minQuality').value),maxKB:Number($('maxKB').value)};}
function setPrefs(){ $('singleFormat').value=state.preferences.format; for(const k of ['format','quality','minQuality','maxKB'])$(k).value=state.preferences[k];for(const k of ['allowOpaqueLayers','allowOpaqueLayersModel'])$(k).checked=!!state.preferences.allowOpaqueLayers;}
for(const id of ['format','quality','minQuality','maxKB'])$(id).onchange=()=>safe(async()=>{await api('/api/preferences','PUT',readPrefs());state.preferences={...state.preferences,...readPrefs()};requestPreview();});
function renderSummary(){const items=selected(),ready=items.filter(p=>!state.readiness[p.key]);$('exportSummary').textContent=`${items.length} selecionados · ${ready.length} revisados e prontos · ${items.length-ready.length} pendentes. Dimensões são definidas pelo modelo ou ajuste individual.`;$('exportBatch').disabled=!items.length;}
async function exportBatch(keys,one=false){
  await flushModel(); const preferences={...readPrefs(),...(one?{format:$('singleFormat').value}:{})}; const {id}=await api('/api/export','POST',{keys,preferences});
  showPage('export');$('exportBatch').disabled=true;$('downloadZip').hidden=true;$('retryFailed').hidden=true;$('exportProgress').hidden=false;
  let job;
  do{job=await api(`/api/jobs/${id}`);lastJob=job;renderJob(job);if(!job.complete)await new Promise(r=>setTimeout(r,650));}while(!job.complete);
  $('exportBatch').disabled=!selected().length;
  if(job.error)throw new Error(job.error);
  if(one&&job.results[0]?.status==='ok')download(`/api/jobs/${id}/download/${encodeURIComponent(job.results[0].file)}`);
}
function renderJob(j){
  $('exportProgress').value=j.total?j.done/j.total*100:0;$('exportStatus').textContent=`${j.phase} · ${j.done} / ${j.total} · ${j.results.filter(r=>r.status==='ok').length} arquivos prontos${j.error?` · ${j.error}`:''}`;
  $('downloadZip').hidden=!j.complete||!!j.error;$('downloadZip').href=`/api/jobs/${j.id}/download/lote.zip`;
  $('retryFailed').hidden=!j.complete||!j.results.some(r=>r.status!=='ok');
  $('results').innerHTML=j.results.map(r=>`<div class="result-row ${r.status}"><div><strong>${escape(r.name)}</strong><small>${r.status==='ok'?`${escape(r.file)}<br>${r.width} × ${r.height} px · ${prettySize(r.bytes)}${r.quality?` · qualidade ${r.quality}`:''}`:escape(r.error)}</small>${r.warnings?.length?`<small>${escape(r.warnings.join(' '))}</small>`:''}</div><div><span class="badge">${({ok:'Pronto',pending:'Pendente',error:'Falha'})[r.status]}</span>${j.complete&&r.status==='ok'?`<br><a href="/api/jobs/${j.id}/download/${encodeURIComponent(r.file)}">Baixar imagem</a>`:''}${r.status!=='ok'?`<br><button class="subtle" data-fix="${escape(r.key)}">Revisar</button>`:''}</div></div>`).join('');
  document.querySelectorAll('[data-fix]').forEach(b=>b.onclick=()=>{currentKey=b.dataset.fix;individual=true;renderList();renderInspector();showPage('edit');});
}
$('exportBatch').onclick=()=>safe(()=>exportBatch(selected().map(p=>p.key)));
$('singleFormat').onchange=()=>safe(async()=>{ $('format').value=$('singleFormat').value; await api('/api/preferences','PUT',readPrefs()); state.preferences={...state.preferences,...readPrefs()}; requestPreview(); });
$('exportOne').onclick=()=>safe(()=>exportBatch([currentKey],true));
$('retryFailed').onclick=()=>safe(()=>exportBatch(lastJob.results.filter(r=>r.status!=='ok').map(r=>r.key)));
function download(url){const a=document.createElement('a');a.href=url;a.download='';document.body.append(a);a.click();a.remove();}
$('exportModels').onclick=()=>safe(async()=>{await flushModel();download('/api/templates-export');});
$('modelFiles').onchange=e=>safe(async()=>{const f=e.target.files[0];if(!f)return;const form=new FormData();form.append('file',f);await api('/api/templates-import','POST',form);await refresh();toast('Modelos e PNGs importados.');e.target.value='';});
await safe(async()=>{await refresh();const id=localStorage.getItem('coverbatch-job');if(id){try{lastJob=await api(`/api/jobs/${id}`);renderJob(lastJob);}catch{}}});
window.addEventListener('beforeunload',()=>{if(lastJob?.id)localStorage.setItem('coverbatch-job',lastJob.id);});
