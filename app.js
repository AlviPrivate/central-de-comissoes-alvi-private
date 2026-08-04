const defaultSettings = {
  rent: {
    inspectionDefault: 215,
    documentsFixed: 0,
    adminNewGross: 5,
    adminAlviGross: 5,
    doorNet: 5,
    captor: 10,
    relocation: 10,
    newAdmin: 5,
    broker: 41,
    manager: 7.5,
    extra1: 0,
    extra2: 0,
    extra3: 0
  },
  sale: { taxRate: 0, adminRate: 5, doorRate: 5, captor: 10, broker: 40, manager: 10, legal: 5 }
};

const SETTINGS_VERSION = 5;
const storedSettings = JSON.parse(localStorage.getItem('alviCommissionSettings') || 'null');
let settings = storedSettings || structuredClone(defaultSettings);
const storedVersion = Number(localStorage.getItem('alviCommissionSettingsVersion') || 0);
if (settings?.sale && 'alvi' in settings.sale) delete settings.sale.alvi;
// Migração v5: a relocação passa a ter percentual próprio de 10%.
// O valor só é aplicado quando o nome do responsável pela relocação é preenchido.
if (storedVersion < 5) {
  settings.rent = settings.rent || {};
  settings.rent.relocation = 10;
}
localStorage.setItem('alviCommissionSettingsVersion', String(SETTINGS_VERSION));
if (settings.rent.inspectionFixed !== undefined && settings.rent.inspectionDefault === undefined) settings.rent.inspectionDefault = settings.rent.inspectionFixed;
if (settings.rent.adminGross !== undefined && settings.rent.adminNewGross === undefined) settings.rent.adminNewGross = settings.rent.adminGross;
if (settings.rent.adminNormalGross !== undefined && settings.rent.adminAlviGross === undefined) settings.rent.adminAlviGross = settings.rent.adminNormalGross;
settings = { rent: { ...defaultSettings.rent, ...settings.rent }, sale: { ...defaultSettings.sale, ...settings.sale } };
localStorage.setItem('alviCommissionSettings', JSON.stringify(settings));
let history = JSON.parse(localStorage.getItem('alviCommissionHistory') || '[]');
let lastRent = null;
let lastSale = null;
let editingId = null;
let pendingOnly = false;

const $ = id => document.getElementById(id);
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
const pct = value => `${Number(value || 0).toFixed(2).replace('.', ',')}%`;
const num = value => Number(String(value ?? '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.')) || 0;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const addressText = x => {
  const base = x.address || 'Imóvel sem endereço';
  const number = x.number ? `, ${x.number}` : '';
  const complement = x.complement ? ` — ${x.complement}` : '';
  return `${base}${number}${complement}`;
};
const referenceText = x => x.propertyReference || x.reference || '';


const statusLabels = { em_analise:'Em análise', aprovada:'Aprovada', aguardando_pagamento:'Aguardando pagamento', paga_parcialmente:'Paga parcialmente', paga:'Paga', cancelada:'Cancelada' };
function setConference(id, expected, distributed) {
  const el = $(id); if (!el) return;
  const diff = Math.abs((Number(expected)||0) - (Number(distributed)||0));
  const ok = diff < 0.02;
  el.className = `conference-box ${ok ? 'ok' : 'error'}`;
  el.innerHTML = `<span>${ok ? '✓ Valores conferidos' : '⚠ Diferença encontrada'}</span><strong>${ok ? money(0) : money(diff)}</strong>`;
}
function statusBadge(status='em_analise') { return `<span class="status-badge ${status}">${statusLabels[status] || status}</span>`; }

function toast(message) {
  $('toast').querySelector('p').textContent = message;
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), 2600);
}

function navigate(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $(id).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === id));
  $('pageTitle').textContent = { dashboard:'Visão geral', locacao:'Comissão de Locação', venda:'Comissão de Venda', historico:'Histórico', configuracoes:'Configurações' }[id];
  $('sidebar').classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (id === 'dashboard') renderDashboard();
  if (id === 'historico') renderHistory();
  if (id === 'configuracoes') renderSettings();
}

document.querySelectorAll('[data-view],[data-go]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.view || el.dataset.go)));
$('menuBtn').onclick = () => $('sidebar').classList.toggle('open');
$('printBtn').onclick = () => window.print();

function line(label, value, detail = '') {
  return `<div class="result-line"><div><span>${esc(label)}</span>${detail ? `<small>${esc(detail)}</small>` : ''}</div><strong>${money(value)}</strong></div>`;
}

function selectedAdminType() {
  return document.querySelector('input[name="rentAdminType"]:checked')?.value || 'none';
}

function calculateRent() {
  const gross = num($('rentGross').value);
  const inspection = num($('rentInspection').value);
  const s = settings.rent;
  const adminType = selectedAdminType();
  // A ADM fixa de 5% é descontada sempre, independentemente da opção selecionada.
  const adminRate = s.adminNewGross;
  const documents = s.documentsFixed;
  const admin = gross * adminRate / 100;
  const beforeDoor = Math.max(0, gross - inspection - documents - admin);
  const door = beforeDoor * s.doorNet / 100;
  const netBeforeNewAdmin = Math.max(0, beforeDoor - door);
  // A ADM Nova é um desconto adicional, e não um participante da distribuição.
  const newAdminRate = adminType === 'new' ? s.newAdmin : 0;
  const newAdmin = netBeforeNewAdmin * newAdminRate / 100;
  const net = Math.max(0, netBeforeNewAdmin - newAdmin);
  const relocationName = $('rentRelocation').value.trim();
  const relocationRate = relocationName ? s.relocation : 0;
  const parts = [
    ['Captador do imóvel', net * s.captor / 100, pct(s.captor), $('rentCaptor').value],
    ['Responsável pela relocação', net * relocationRate / 100, pct(relocationRate), relocationName],
    ['Corretor', net * s.broker / 100, pct(s.broker), $('rentBroker').value],
    ['Gerente', net * s.manager / 100, pct(s.manager), $('rentManager').value],
    ['Adicional 1', net * s.extra1 / 100, pct(s.extra1), ''],
    ['Adicional 2', net * s.extra2 / 100, pct(s.extra2), ''],
    ['Adicional 3', net * s.extra3 / 100, pct(s.extra3), '']
  ];
  const assigned = parts.reduce((a, p) => a + p[1], 0);
  const alvi = Math.max(0, net - assigned);
  parts.push(['Alvi Private', alvi, 'Saldo da distribuição', 'Alvi Private']);

  lastRent = {
    type: 'locacao', createdAt: new Date().toISOString(),
    address: $('rentAddress').value || 'Imóvel sem endereço', number: $('rentNumber').value,
    complement: $('rentComplement').value, propertyReference: $('rentReference').value, owner: $('rentOwner').value,
    tenant: $('rentTenant').value, broker: $('rentBroker').value, gross, inspection, documents,
    admin, adminRate, adminType, newAdmin, newAdminRate, beforeDoor, door, net, parts, alvi, guarantee: $('rentGuarantee').value,
    date: $('rentDate').value, captor: $('rentCaptor').value, manager: $('rentManager').value,
    relocation: $('rentRelocation').value,
    status: $('rentStatus').value, notes: $('rentNotes').value, paymentDate: $('rentPaymentDate').value, paidAmount: num($('rentPaidAmount').value)
  };

  $('rentNet').textContent = money(net);
  $('rentLines').innerHTML =
    line('VALOR BRUTO DA COMISSÃO', gross) +
    line('LAUDO DE VISTORIA', -inspection, 'Valor informado no cálculo') +
    line('Documentos', -documents, 'Valor fixo') +
    line('ADM FIXA', -admin, `${pct(adminRate)} sobre o valor bruto · aplicada sempre`) +
    line('VALOR LÍQUIDO SEM PORTARIA', beforeDoor) +
    line('PORTARIA', -door, `${pct(s.doorNet)} · sobre o líquido sem portaria`) +
    line('VALOR LÍQUIDO', netBeforeNewAdmin) +
    (adminType === 'new' ? line('ADM NOVA', -newAdmin, `${pct(newAdminRate)} sobre o valor líquido`) : '') +
    parts.filter(p => p[1] !== 0).map(p => line(p[0], p[1], `${p[2]}${p[3] ? ` · ${p[3]}` : ''}`)).join('');
  const rentDistributed = parts.reduce((a, p) => a + p[1], 0);
  $('rentDistributed').textContent = money(rentDistributed);
  setConference('rentConference', net, rentDistributed);
  return lastRent;
}

$('rentForm').onsubmit = e => { e.preventDefault(); calculateRent(); toast('Cálculo de locação atualizado.'); };
$('rentRelocation').addEventListener('input', calculateRent);
document.querySelectorAll('input[name="rentAdminType"]').forEach(input => input.addEventListener('change', calculateRent));

function calculateSale() {
  const grossCommission = num($('saleValue').value);
  const taxRate = num($('saleTaxRate').value);
  const tax = grossCommission * taxRate / 100;
  const documents = num($('saleDocuments').value);
  const adminRate = num($('saleAdminRate').value);
  const admin = grossCommission * adminRate / 100;
  const beforeDoor = Math.max(0, grossCommission - tax - documents - admin);
  const doorRate = num($('saleDoorRate').value);
  // A portaria é calculada sobre o valor após Nota Fiscal, Documentos e Administração.
  const door = beforeDoor * doorRate / 100;
  const net = Math.max(0, beforeDoor - door);
  const s = settings.sale;
  const parts = [
    ['Captador do imóvel', net * s.captor / 100, pct(s.captor), $('saleCaptor').value],
    ['Corretor', net * s.broker / 100, pct(s.broker), $('saleBroker').value],
    ['Gerente', net * s.manager / 100, pct(s.manager), $('saleManager').value],
    ['Jurídico', net * s.legal / 100, pct(s.legal), $('saleLegal').value]
  ];
  const assigned = parts.reduce((a, p) => a + p[1], 0);
  const alvi = Math.max(0, net - assigned);
  parts.push(['Alvi Private', alvi, 'Saldo da distribuição', 'Alvi Private']);
  const distributed = parts.reduce((a, p) => a + p[1], 0);
  const totalRate = [s.captor, s.broker, s.manager, s.legal].reduce((a, v) => a + Number(v || 0), 0);
  lastSale = {
    type: 'venda', createdAt: new Date().toISOString(), address: $('saleAddress').value || 'Imóvel sem endereço',
    number: $('saleNumber').value, complement: $('saleComplement').value, propertyReference: $('salePropertyReference').value,
    owner: $('saleOwner').value, buyer: $('saleBuyer').value, broker: $('saleBroker').value,
    value: grossCommission, grossCommission, taxRate, tax, documents, adminRate, admin, beforeDoor, doorRate, door, net,
    total: net, parts, alvi, distributed, totalRate, reference: $('salePropertyReference').value,
    date: $('saleDate').value, captor: $('saleCaptor').value, manager: $('saleManager').value,
    legal: $('saleLegal').value, status: $('saleStatus').value, notes: $('saleNotes').value, paymentDate: $('salePaymentDate').value, paidAmount: num($('salePaidAmount').value)
  };
  $('saleTotalCommission').textContent = money(net);
  $('saleLines').innerHTML =
    line('VALOR BRUTO DA COMISSÃO', grossCommission) +
    line('CUSTO NOTA FISCAL', -tax, pct(taxRate)) +
    line('Docts/DESPACHANTE', -documents, documents ? 'Valor informado' : 'R$ 0,00') +
    line('Adm', -admin, pct(adminRate)) +
    line('VALOR LÍQUIDO S/portaria', beforeDoor) +
    line('PORTARIA', -door, `${pct(doorRate)} · sobre o valor após administração`) +
    line('VALOR LÍQUIDO', net) +
    parts.map(p => line(p[0], p[1], `${p[2]}${p[3] ? ` · ${p[3]}` : ''}`)).join('');
  $('saleDistributed').textContent = money(distributed);
  $('saleDistributed').parentElement.classList.toggle('distribution-warning', totalRate > 100.001);
  setConference('saleConference', net, distributed);
  return lastSale;
}

$('saleForm').onsubmit = e => { e.preventDefault(); calculateSale(); toast('Cálculo de venda atualizado.'); };

function rentReport(x = lastRent) {
  if (!x) return '';
  const type = x.adminType === 'new' ? 'ADM Nova' : 'Sem Administração';
  return `📃 EXTRATO DE COMISSÃO — LOCAÇÃO\n\nEndereço: ${addressText(x)}\nRef.: ${referenceText(x) || '-'}\nLocador: ${x.owner || '-'}\nLocatário: ${x.tenant || '-'}\nGarantia: ${x.guarantee || '-'}\nTipo de administração: ${type}\nStatus: ${statusLabels[x.status || 'em_analise']}\nObservação: ${x.notes || '-'}\nData do pagamento: ${x.paymentDate ? new Date(x.paymentDate+'T12:00:00').toLocaleDateString('pt-BR') : '-'}\nValor já pago: ${money(x.paidAmount || 0)}\nValor bruto: ${money(x.gross)}\nValor líquido distribuível: ${money(x.net)}\n\nDISTRIBUIÇÃO\n${x.parts.filter(p => p[1] !== 0).map(p => `${p[0]}${p[3] ? ` (${p[3]})` : ''}: ${money(p[1])}`).join('\n')}\n\nDESCONTOS\nVistoria: ${money(x.inspection)}\nAdministração: ${money(x.admin)}\nPortaria: ${money(x.door)}`;
}

function saleReport(x = lastSale) {
  if (!x) return '';
  return `📃 EXTRATO DE COMISSÃO — VENDA

Endereço: ${addressText(x)}
Ref.: ${referenceText(x) || '-'}
Proprietário: ${x.owner || '-'}
Comprador: ${x.buyer || '-'}
Status: ${statusLabels[x.status || 'em_analise']}
Observação: ${x.notes || '-'}
Valor bruto da comissão: ${money(x.grossCommission || x.value)}
Valor líquido distribuível: ${money(x.net)}

DESCONTOS
Custo nota fiscal: ${money(x.tax)}
Documentos / despachante: ${money(x.documents)}
Administração: ${money(x.admin)}
Portaria (${pct(x.doorRate || 0)}): ${money(x.door)}

DISTRIBUIÇÃO
${x.parts.filter(p => p[1] !== 0).map(p => `${p[0]}${p[3] ? ` (${p[3]})` : ''}: ${money(p[1])}`).join('\n')}`;
}

async function copy(text) {
  if (!text) return toast('Faça o cálculo primeiro.');
  await navigator.clipboard.writeText(text);
  toast('Relatório copiado.');
}

$('copyRent').onclick = () => copy(rentReport());
$('copySale').onclick = () => copy(saleReport());

function printableRows(parts) {
  return parts.filter(p => p[1] !== 0).map(p => `<tr><td>${esc(p[0])}${p[3] ? `<small>${esc(p[3])}</small>` : ''}</td><td>${esc(p[2])}</td><td>${money(p[1])}</td></tr>`).join('');
}

function generatePdf(item) {
  if (!item) return toast('Faça o cálculo primeiro.');
  const isRent = item.type === 'locacao';
  const title = isRent ? 'Extrato de Comissão — Locação' : 'Extrato de Comissão — Venda';
  const adminType = item.adminType === 'new' ? 'ADM Nova' : 'Sem Administração';
  const details = isRent ? `
    <div><span>Locador</span><strong>${esc(item.owner || '-')}</strong></div>
    <div><span>Locatário</span><strong>${esc(item.tenant || '-')}</strong></div>
    <div><span>Garantia</span><strong>${esc(item.guarantee || '-')}</strong></div>
    <div><span>Administração</span><strong>${adminType}</strong></div>
    <div><span>Valor bruto da comissão</span><strong>${money(item.gross)}</strong></div>
    <div><span>Valor líquido</span><strong>${money(item.net)}</strong></div>` : `
    <div><span>Referência</span><strong>${esc(item.reference || '-')}</strong></div>
    <div><span>Proprietário</span><strong>${esc(item.owner || '-')}</strong></div>
    <div><span>Comprador</span><strong>${esc(item.buyer || '-')}</strong></div>
    <div><span>Valor bruto da comissão</span><strong>${money(item.grossCommission || item.value || item.total)}</strong></div>
    <div><span>Valor líquido</span><strong>${money(item.net || item.total)}</strong></div>`;
  const deductions = isRent ? `<section><h2>Descontos</h2><table><tbody><tr><td>Laudo de vistoria</td><td>${money(item.inspection)}</td></tr><tr><td>Administração</td><td>${money(item.admin)}</td></tr><tr><td>Valor líquido sem portaria</td><td>${money(item.beforeDoor ?? (item.gross - item.inspection - item.documents - item.admin))}</td></tr><tr><td>Portaria</td><td>${money(item.door)}</td></tr></tbody></table></section>` : `<section><h2>Descontos</h2><table><tbody><tr><td>Custo nota fiscal</td><td>${pct(item.taxRate || 0)}</td><td>${money(item.tax || 0)}</td></tr><tr><td>Documentos / despachante</td><td>Valor</td><td>${money(item.documents || 0)}</td></tr><tr><td>Administração</td><td>${pct(item.adminRate || 0)}</td><td>${money(item.admin || 0)}</td></tr><tr><td>Portaria</td><td>${pct(item.doorRate || 0)}</td><td>${money(item.door || 0)}</td></tr></tbody></table></section>`;
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${title}</title><style>
    @page{size:A4 landscape;margin:11mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#211e1a;margin:0;background:#fff}.head{border-bottom:3px solid #c99b52;padding-bottom:10px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:flex-end}.brand{font-weight:800;letter-spacing:2px}.brand small{display:block;font-weight:400;letter-spacing:0;color:#777;margin-top:3px}.date{font-size:10px;color:#777}h1{font-family:Georgia,serif;font-size:23px;margin:0 0 4px}h2{font-size:11px;text-transform:uppercase;letter-spacing:1.3px;margin:12px 0 7px;color:#9a6c27}.address{font-size:12px;color:#555;margin-bottom:8px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px 18px;background:#f7f3ec;padding:11px 14px;border-radius:9px}.grid div{border-bottom:1px solid #e4ddd3;padding:5px 0}.grid span{display:block;font-size:8px;text-transform:uppercase;color:#888;margin-bottom:2px}.grid strong{font-size:11px}.report-columns{display:grid;grid-template-columns:.88fr 1.12fr;gap:18px;align-items:start}section{break-inside:avoid}table{width:100%;border-collapse:collapse}th,td{padding:6px 7px;border-bottom:1px solid #e7e1d8;text-align:left;font-size:10px}th{text-transform:uppercase;font-size:8px;color:#777}td:last-child,th:last-child{text-align:right}td small{display:block;color:#888;margin-top:2px}.total{margin-top:10px;background:#1b1814;color:#fff;padding:11px 14px;border-radius:8px;display:flex;justify-content:space-between;font-size:12px}.total strong{color:#d9ad65}.footer{margin-top:12px;padding-top:8px;border-top:1px solid #ddd;font-size:8px;color:#888;text-align:center}.no-print{margin:10px auto;display:block;padding:9px 16px;background:#c99b52;border:0;border-radius:8px;font-weight:bold;cursor:pointer}@media print{.no-print{display:none}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body><button class="no-print" onclick="window.print()">Salvar como PDF / Imprimir</button><div class="head"><div><div class="brand">ALVI PRIVATE<small>Inteligência Imobiliária</small></div></div><div class="date">Emitido em ${new Date().toLocaleString('pt-BR')}</div></div><h1>${title}</h1><div class="address">${esc(addressText(item))}${referenceText(item) ? `<br>Ref.: ${esc(referenceText(item))}` : ''}</div><section><h2>Dados da operação</h2><div class="grid">${details}</div></section><div class="report-columns"><div>${deductions}</div><section><h2>Distribuição da comissão</h2><table><thead><tr><th>Participante</th><th>Regra</th><th>Valor</th></tr></thead><tbody>${printableRows(item.parts)}</tbody></table></section></div><div class="total"><span>${isRent ? 'Valor líquido distribuível' : 'Comissão total'}</span><strong>${money(isRent ? item.net : item.total)}</strong></div><div class="footer">Documento gerado pela Central de Comissões Alvi Private.</div><script>setTimeout(()=>window.print(),400)<\/script></body></html>`;
  const win = window.open('', '_blank');
  if (!win) return toast('Permita pop-ups para gerar o PDF.');
  win.document.open(); win.document.write(html); win.document.close();
}

$('pdfRent').onclick = () => generatePdf(lastRent);
$('pdfSale').onclick = () => generatePdf(lastSale);

function save(item) {
  if (!item) return toast('Faça o cálculo primeiro.');
  if (editingId) {
    const index = history.findIndex(x => x.id === editingId);
    if (index >= 0) history[index] = { ...item, id: editingId, updatedAt: new Date().toISOString() };
    toast('Registro atualizado com sucesso.');
  } else {
    history.unshift({ ...item, id: crypto.randomUUID() });
    toast('Cálculo salvo no histórico.');
  }
  localStorage.setItem('alviCommissionHistory', JSON.stringify(history));
  editingId = null;
  $('saveRent').textContent = 'Salvar cálculo';
  $('saveSale').textContent = 'Salvar cálculo';
  renderDashboard();
}
$('saveRent').onclick = () => save(lastRent);
$('saveSale').onclick = () => save(lastSale);
$('duplicateRent').onclick = () => { if (!lastRent) return toast('Faça o cálculo primeiro.'); editingId = null; $('saveRent').textContent='Salvar cópia'; toast('Cópia preparada. Altere os dados e salve.'); };
$('duplicateSale').onclick = () => { if (!lastSale) return toast('Faça o cálculo primeiro.'); editingId = null; $('saveSale').textContent='Salvar cópia'; toast('Cópia preparada. Altere os dados e salve.'); };

function renderDashboard() {
  $('statCount').textContent = history.length;
  $('statRent').textContent = money(history.filter(x => x.type === 'locacao').reduce((a, x) => a + x.gross, 0));
  $('statSale').textContent = money(history.filter(x => x.type === 'venda').reduce((a, x) => a + x.value, 0));
  $('statAlvi').textContent = money(history.reduce((a, x) => a + (x.alvi || 0), 0));
  const recent = history.slice(0, 4);
  $('recentList').classList.toggle('empty-state', !recent.length);
  $('recentList').innerHTML = recent.length ? recent.map(x => `<div class="recent-item"><div><strong>${esc(addressText(x))}</strong><small>${x.type === 'locacao' ? 'Locação' : 'Venda'} · ${new Date(x.createdAt).toLocaleDateString('pt-BR')}</small></div><strong>${money(x.type === 'locacao' ? x.gross : x.total)}</strong></div>`).join('') : 'Nenhum cálculo salvo ainda.';
}

function openConfirm({title, message, summary='', acceptLabel='Confirmar'}) {
  return new Promise(resolve => {
    const overlay = $('confirmOverlay');
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = message;
    $('confirmSummary').innerHTML = summary;
    $('confirmSummary').style.display = summary ? 'block' : 'none';
    $('confirmAccept').textContent = acceptLabel;
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden','false');
    document.body.classList.add('modal-open');
    const close = result => {
      overlay.classList.remove('show');
      overlay.setAttribute('aria-hidden','true');
      document.body.classList.remove('modal-open');
      $('confirmAccept').onclick = null; $('confirmCancel').onclick = null; $('confirmClose').onclick = null; overlay.onclick = null;
      resolve(result);
    };
    $('confirmAccept').onclick = () => close(true);
    $('confirmCancel').onclick = () => close(false);
    $('confirmClose').onclick = () => close(false);
    overlay.onclick = e => { if (e.target === overlay) close(false); };
    setTimeout(() => $('confirmAccept').focus(), 180);
  });
}
window.changeHistoryStatus = (id, status) => {
  const item = history.find(i => i.id === id); if (!item) return;
  item.status = status;
  if (status === 'paga' && !item.paymentDate) item.paymentDate = new Date().toISOString().slice(0,10);
  localStorage.setItem('alviCommissionHistory', JSON.stringify(history));
  renderHistory(); renderDashboard(); toast(`Status alterado para ${statusLabels[status]}.`);
};

function renderHistory() {
  const q = $('historySearch').value.toLowerCase();
  const f = $('historyFilter').value;
  const sf = $('historyStatus').value;
  const list = history.filter(x => (f === 'all' || x.type === f) && (sf === 'all' || (x.status || 'em_analise') === sf) && (!pendingOnly || !['paga','cancelada'].includes(x.status || 'em_analise')) && JSON.stringify(x).toLowerCase().includes(q));
  $('historyList').innerHTML = list.length ? list.map(x => { const total=x.type==='locacao'?x.gross:x.value; const paid=Number(x.paidAmount||0); const remaining=Math.max(0,total-paid); return `<div class="history-row"><span class="type-badge ${x.type}">${x.type.toUpperCase()}</span><div><strong>${esc(addressText(x))}</strong><small>${esc(x.owner || x.buyer || 'Sem cliente informado')}</small>${statusBadge(x.status || 'em_analise')}</div><div><strong>${money(total)}</strong><small>Pago: ${money(paid)} · Saldo: ${money(remaining)}</small></div><div><strong>${esc(x.broker || '-')}</strong><small>${new Date(x.createdAt).toLocaleString('pt-BR')}</small><select class="status-quick ${x.status||'em_analise'}" onchange="changeHistoryStatus('${x.id}', this.value)"><option value="em_analise" ${(x.status||'em_analise')==='em_analise'?'selected':''}>Em análise</option><option value="aprovada" ${x.status==='aprovada'?'selected':''}>Aprovada</option><option value="aguardando_pagamento" ${x.status==='aguardando_pagamento'?'selected':''}>Aguardando pagamento</option><option value="paga_parcialmente" ${x.status==='paga_parcialmente'?'selected':''}>Paga parcialmente</option><option value="paga" ${x.status==='paga'?'selected':''}>Paga</option><option value="cancelada" ${x.status==='cancelada'?'selected':''}>Cancelada</option></select></div><div class="history-actions"><button class="icon-btn edit" onclick="editHistory('${x.id}')" title="Editar" aria-label="Editar" data-tooltip="Editar">✎</button><button class="icon-btn duplicate" onclick="duplicateHistory('${x.id}')" title="Duplicar" aria-label="Duplicar" data-tooltip="Duplicar">⧉</button><button class="icon-btn pdf" onclick="pdfHistory('${x.id}')" title="Gerar PDF" aria-label="Gerar PDF" data-tooltip="PDF">PDF</button><button class="icon-btn copy" onclick="copyHistory('${x.id}')" title="Copiar relatório" aria-label="Copiar relatório" data-tooltip="Copiar">▣</button><button class="icon-btn delete" onclick="deleteHistory('${x.id}')" title="Excluir" aria-label="Excluir" data-tooltip="Excluir">×</button></div></div>`; }).join('') : '<div class="empty-state">Nenhum registro encontrado.</div>';
}
function fillField(id, value) { if ($(id)) $(id).value = value ?? ''; }
window.editHistory = id => {
  const x = history.find(i => i.id === id); if (!x) return;
  editingId = id;
  if (x.type === 'locacao') {
    fillField('rentAddress',x.address); fillField('rentNumber',x.number); fillField('rentComplement',x.complement); fillField('rentReference',referenceText(x)); fillField('rentOwner',x.owner); fillField('rentTenant',x.tenant); fillField('rentGross',String(x.gross||'').replace('.',',')); fillField('rentInspection',String(x.inspection||'').replace('.',',')); fillField('rentGuarantee',x.guarantee); fillField('rentDate',x.date); fillField('rentStatus',x.status||'em_analise'); fillField('rentNotes',x.notes); fillField('rentPaymentDate',x.paymentDate); fillField('rentPaidAmount',String(x.paidAmount||0).replace('.',',')); fillField('rentCaptor',x.captor); fillField('rentBroker',x.broker); fillField('rentManager',x.manager); fillField('rentRelocation',x.relocation); const savedAdminType = x.adminType === 'alvi' ? 'none' : (x.adminType || 'none'); const radio=document.querySelector(`input[name="rentAdminType"][value="${savedAdminType}"]`); if(radio) radio.checked=true; calculateRent(); $('saveRent').textContent='Atualizar registro'; navigate('locacao');
  } else {
    fillField('saleAddress',x.address); fillField('saleNumber',x.number); fillField('saleComplement',x.complement); fillField('salePropertyReference',referenceText(x)); fillField('saleOwner',x.owner); fillField('saleBuyer',x.buyer); fillField('saleValue',String(x.grossCommission||x.value||'').replace('.',',')); fillField('saleDate',x.date); fillField('saleStatus',x.status||'em_analise'); fillField('saleNotes',x.notes); fillField('salePaymentDate',x.paymentDate); fillField('salePaidAmount',String(x.paidAmount||0).replace('.',',')); fillField('saleTaxRate',String(x.taxRate||0).replace('.',',')); fillField('saleDocuments',String(x.documents||0).replace('.',',')); fillField('saleAdminRate',String(x.adminRate||0).replace('.',',')); fillField('saleDoorRate',String(x.doorRate||0).replace('.',',')); fillField('saleCaptor',x.captor); fillField('saleBroker',x.broker); fillField('saleManager',x.manager); fillField('saleLegal',x.legal); calculateSale(); $('saveSale').textContent='Atualizar registro'; navigate('venda');
  }
  toast('Registro carregado para edição.');
};
window.duplicateHistory = id => { const x=history.find(i=>i.id===id); if(!x)return; window.editHistory(id); editingId=null; if(x.type==='locacao') $('saveRent').textContent='Salvar cópia'; else $('saveSale').textContent='Salvar cópia'; toast('Cópia preparada.'); };
window.copyHistory = id => { const x = history.find(i => i.id === id); copy(x.type === 'locacao' ? rentReport(x) : saleReport(x)); };
window.pdfHistory = id => generatePdf(history.find(i => i.id === id));
window.deleteHistory = async id => { const x=history.find(i=>i.id===id); if(!x)return; const ok=await openConfirm({title:'Excluir esta comissão?',message:'O registro será removido permanentemente do histórico deste navegador.',summary:`<div><span>Imóvel</span><strong>${esc(addressText(x))}</strong></div><div><span>Tipo</span><strong>${x.type==='locacao'?'Locação':'Venda'}</strong></div><div><span>Valor</span><strong>${money(x.type==='locacao'?x.gross:x.value)}</strong></div>`,acceptLabel:'Sim, excluir registro'}); if(!ok)return; history=history.filter(i=>i.id!==id); localStorage.setItem('alviCommissionHistory',JSON.stringify(history)); renderHistory(); renderDashboard(); toast('Registro excluído com segurança.'); };
$('historySearch').oninput = renderHistory;
$('historyFilter').onchange = renderHistory;
$('historyStatus').onchange = renderHistory;
$('pendingOnly').onclick = () => { pendingOnly=!pendingOnly; $('pendingOnly').textContent=pendingOnly?'Mostrando pendentes':'Somente pendentes'; $('pendingOnly').classList.toggle('gold',pendingOnly); renderHistory(); };
$('clearHistory').onclick = async () => { if(!history.length) return toast('O histórico já está vazio.'); const ok=await openConfirm({title:'Apagar todo o histórico?',message:'Todos os cálculos salvos neste navegador serão excluídos. Esta ação não poderá ser desfeita.',summary:`<div><span>Registros</span><strong>${history.length}</strong></div><div><span>Locações</span><strong>${history.filter(x=>x.type==='locacao').length}</strong></div><div><span>Vendas</span><strong>${history.filter(x=>x.type==='venda').length}</strong></div>`,acceptLabel:'Apagar tudo'}); if(!ok)return; history=[]; localStorage.setItem('alviCommissionHistory','[]'); renderHistory(); renderDashboard(); toast('Histórico apagado com segurança.'); };

const rentDefs = [
  ['inspectionDefault','Vistoria padrão','Valor sugerido ao iniciar um cálculo','R$'],
  ['documentsFixed','Documentos','Valor fixo descontado','R$'],
  ['adminNewGross','ADM Fixa','Desconto fixo sobre o valor bruto','%'],
  ['doorNet','Portaria','Sobre o líquido antes da portaria','%'],
  ['captor','Captador do imóvel','Distribuição do líquido','%'],
  ['relocation','Responsável pela relocação','Calculado somente quando houver um nome informado','%'],
  ['newAdmin','ADM Nova','Desconto adicional sobre o líquido após a portaria, aplicado somente quando ADM Nova estiver selecionada','%'],
  ['broker','Corretor','Distribuição do líquido','%'],
  ['manager','Gerente','Distribuição do líquido','%'],
  ['extra1','Adicional 1','Distribuição opcional','%'],
  ['extra2','Adicional 2','Distribuição opcional','%'],
  ['extra3','Adicional 3','Distribuição opcional','%']
];
const saleDefs = [
  ['taxRate','Custo nota fiscal padrão','Sobre a comissão bruta','%'],
  ['adminRate','Administração padrão','Sobre a comissão bruta','%'],
  ['doorRate','Portaria padrão','Sobre o valor após Nota Fiscal, Documentos e Administração','%'],
  ['captor','Captador do imóvel','Distribuição do líquido','%'],
  ['broker','Corretor','Distribuição do líquido','%'],
  ['manager','Gerente','Distribuição do líquido','%'],
  ['legal','Jurídico','Distribuição do líquido','%']
];
function fields(defs, group) {
  return defs.map(([key, label, desc, suffix]) => `<div class="setting-row"><label>${esc(label)}<small>${esc(desc)}</small></label><div class="setting-input"><input data-setting="${group}.${key}" inputmode="decimal" value="${String(settings[group][key]).replace('.', ',')}"><span>${suffix}</span></div></div>`).join('');
}
function renderSettings() {
  $('rentSettingsFields').innerHTML = fields(rentDefs, 'rent');
  $('saleSettingsFields').innerHTML = fields(saleDefs, 'sale');
  updateSums();
  document.querySelectorAll('[data-setting]').forEach(input => input.oninput = updateSums);
}
function readSetting(path) { return num(document.querySelector(`[data-setting="${path}"]`)?.value); }
function updateSums() {
  const r = ['captor','relocation','newAdmin','broker','manager','extra1','extra2','extra3'].reduce((a, k) => a + readSetting(`rent.${k}`), 0);
  const sv = ['captor','broker','manager','legal'].reduce((a, k) => a + readSetting(`sale.${k}`), 0);
  $('rentSplitSum').textContent = pct(r);
  $('rentSplitSum').parentElement.classList.toggle('invalid', r > 100);
  $('saleSplitSum').textContent = pct(sv);
  $('saleSplitSum').parentElement.classList.toggle('invalid', sv > 100.01);
}
function saveSettings(group, defs) {
  defs.forEach(([key]) => settings[group][key] = readSetting(`${group}.${key}`));
  localStorage.setItem('alviCommissionSettings', JSON.stringify(settings));
  if (group === 'rent' && !$('rentInspection').value) $('rentInspection').value = String(settings.rent.inspectionDefault).replace('.', ',');
  toast('Configurações salvas.');
}
$('rentSettingsForm').onsubmit = e => { e.preventDefault(); saveSettings('rent', rentDefs); };
$('saleSettingsForm').onsubmit = e => { e.preventDefault(); saveSettings('sale', saleDefs); };
$('restoreSettings').onclick = () => { if (confirm('Restaurar todas as configurações padrão?')) { settings = structuredClone(defaultSettings); localStorage.setItem('alviCommissionSettings', JSON.stringify(settings)); renderSettings(); setInitialValues(); toast('Padrões restaurados.'); } };
$('exportData').onclick = () => { const blob = new Blob([JSON.stringify({ settings, history }, null, 2)], { type:'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'backup-comissoes-alvi.json'; a.click(); URL.revokeObjectURL(a.href); };
$('importData').onchange = async e => { try { const data = JSON.parse(await e.target.files[0].text()); settings = data.settings || settings; history = data.history || history; localStorage.setItem('alviCommissionSettings', JSON.stringify(settings)); localStorage.setItem('alviCommissionHistory', JSON.stringify(history)); renderSettings(); renderDashboard(); setInitialValues(); toast('Backup importado.'); } catch { toast('Arquivo de backup inválido.'); } };

function resetForm(formId) {
  $(formId).reset();
  setInitialValues();
}
$('resetRent').onclick = () => { resetForm('rentForm'); editingId=null; $('saveRent').textContent='Salvar cálculo'; lastRent = null; $('rentNet').textContent = money(0); $('rentLines').innerHTML = ''; $('rentDistributed').textContent = money(0); $('rentConference').className='conference-box'; $('rentConference').innerHTML='<span>Conferência</span><strong>Aguardando cálculo</strong>'; };
$('resetSale').onclick = () => { resetForm('saleForm'); editingId=null; $('saveSale').textContent='Salvar cálculo'; lastSale = null; $('saleTotalCommission').textContent = money(0); $('saleLines').innerHTML = ''; $('saleDistributed').textContent = money(0); $('saleConference').className='conference-box'; $('saleConference').innerHTML='<span>Conferência</span><strong>Aguardando cálculo</strong>'; };


const savedTheme = localStorage.getItem('alviTheme') || 'light';
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('alviTheme', theme);
  const dark = theme === 'dark';
  $('themeIcon').textContent = dark ? '☀' : '☾';
  $('themeLabel').textContent = dark ? 'Claro' : 'Escuro';
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#0d0d0c' : '#f4f1eb');
}
$('themeToggle').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
applyTheme(savedTheme);

function setInitialValues() {
  $('rentInspection').value = String(settings.rent.inspectionDefault).replace('.', ',');
  $('saleTaxRate').value = String(settings.sale.taxRate).replace('.', ',');
  $('saleAdminRate').value = String(settings.sale.adminRate).replace('.', ',');
  $('saleDoorRate').value = String(settings.sale.doorRate).replace('.', ',');
  if (!$('rentDate').value) $('rentDate').valueAsDate = new Date();
  if (!$('saleDate').value) $('saleDate').valueAsDate = new Date();
}

setInitialValues();
renderDashboard();
