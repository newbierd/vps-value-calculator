import { useEffect, useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { Calculator, Copy, History, ImageDown, Link, RefreshCw, Server, Trash2 } from 'lucide-react'
import './App.css'

type Currency = 'CNY' | 'USD' | 'HKD' | 'EUR' | 'JPY' | 'SGD' | 'GBP' | 'AUD' | 'CAD'
type Cycle = 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'biennial' | 'triennial' | 'custom'
type RoundMode = 'none' | 'floor' | 'round' | 'ceil'
type FeeBearer = 'buyer' | 'seller'

type FormState = {
  provider: string
  plan: string
  region: string
  cpu: string
  ram: string
  storage: string
  bandwidth: string
  traffic: string
  ip: string
  tags: string
  renewalPrice: number
  renewalCurrency: Currency
  tradeCurrency: Currency
  billingCycle: Cycle
  customDays: number
  expiryDate: string
  tradeDate: string
  premium: number
  targetPrice: number | ''
  pushFee: number
  feeBearer: FeeBearer
  roundMode: RoundMode
  transferMethod: string
  contact: string
  testUrl: string
  notes: string
  manualRate: number | ''
}

type RateState = {
  rates: Partial<Record<Currency, number>>
  base: Currency
  source: 'live' | 'cache' | 'fallback' | 'manual'
  provider: string
  updatedAt: string
  error?: string
}

type HistoryItem = {
  id: string
  time: string
  provider: string
  plan: string
  finalPrice: number
  currency: Currency
  remainingDays: number
}

const currencies: Currency[] = ['CNY', 'USD', 'HKD', 'EUR', 'JPY', 'SGD', 'GBP', 'AUD', 'CAD']
const currencySymbol: Record<Currency, string> = { CNY: '¥', USD: '$', HKD: 'HK$', EUR: '€', JPY: '¥', SGD: 'S$', GBP: '£', AUD: 'A$', CAD: 'C$' }
const cycleDays: Record<Exclude<Cycle, 'custom'>, number> = { monthly: 30, quarterly: 90, semiannual: 180, annual: 365, biennial: 730, triennial: 1095 }
const cycleLabel: Record<Cycle, string> = { monthly: '月付', quarterly: '季付', semiannual: '半年付', annual: '年付', biennial: '两年付', triennial: '三年付', custom: '自定义' }
const currencyLabel: Record<Currency, string> = { CNY: 'CNY 人民币', USD: 'USD 美元', HKD: 'HKD 港元', EUR: 'EUR 欧元', JPY: 'JPY 日元', SGD: 'SGD 新加坡元', GBP: 'GBP 英镑', AUD: 'AUD 澳元', CAD: 'CAD 加拿大元' }
const feeBearerLabel: Record<FeeBearer, string> = { buyer: '买家承担', seller: '卖家承担' }
const roundModeLabel: Record<RoundMode, string> = { none: '不取整', floor: '向下取整', round: '四舍五入', ceil: '向上取整' }
const rateSourceLabel: Record<RateState['source'], string> = { live: '实时汇率', cache: '缓存汇率', fallback: '备用汇率', manual: '手动汇率' }
const fallbackRates: Record<Currency, number> = { USD: 1, CNY: 7.2, HKD: 7.8, EUR: 0.92, JPY: 155, SGD: 1.34, GBP: 0.78, AUD: 1.52, CAD: 1.37 }
const defaultForm: FormState = {
  provider: '', plan: '', region: '', cpu: '', ram: '', storage: '', bandwidth: '', traffic: '', ip: '', tags: '',
  renewalPrice: 12.99, renewalCurrency: 'USD', tradeCurrency: 'CNY', billingCycle: 'annual', customDays: 365,
  expiryDate: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10), tradeDate: new Date().toISOString().slice(0, 10),
  premium: 0, targetPrice: '', pushFee: 0, feeBearer: 'buyer', roundMode: 'round', transferMethod: 'Push / 改邮箱', contact: '', testUrl: '', notes: '', manualRate: ''
}

const STORAGE_KEY = 'vps-value-calculator-form-v1'
const HISTORY_KEY = 'vps-value-calculator-history-v1'
const RATE_KEY = 'vps-value-calculator-rates-v1'

function daysBetween(start: string, end: string) {
  const s = new Date(`${start}T00:00:00`)
  const e = new Date(`${end}T00:00:00`)
  return Math.ceil((e.getTime() - s.getTime()) / 86400000)
}
function money(n: number, c: Currency) { return `${currencySymbol[c]}${n.toFixed(2)} ${c}` }
function convert(amount: number, from: Currency, to: Currency, rates: Partial<Record<Currency, number>>) {
  if (from === to) return amount
  const fromRate = rates[from] || fallbackRates[from]
  const toRate = rates[to] || fallbackRates[to]
  return (amount / fromRate) * toRate
}
function applyRound(v: number, mode: RoundMode) {
  if (mode === 'floor') return Math.floor(v)
  if (mode === 'ceil') return Math.ceil(v)
  if (mode === 'round') return Math.round(v)
  return v
}
function encodeShare(form: FormState) { return btoa(unescape(encodeURIComponent(JSON.stringify(form)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') }
function decodeShare(s: string) { return JSON.parse(decodeURIComponent(escape(atob(s.replaceAll('-', '+').replaceAll('_', '/'))))) as FormState }

async function getJson(url: string, timeout = 5000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally { clearTimeout(t) }
}

function App() {
  const resultRef = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState<FormState>(() => {
    const params = new URLSearchParams(location.search)
    const data = params.get('data')
    if (data) { try { return { ...defaultForm, ...decodeShare(data) } } catch { /* ignore */ } }
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) { try { return { ...defaultForm, ...JSON.parse(raw) } } catch { /* ignore */ } }
    return defaultForm
  })
  const [rates, setRates] = useState<RateState>({ rates: fallbackRates, base: 'USD', source: 'fallback', provider: '内置备用汇率', updatedAt: new Date().toISOString() })
  const [history, setHistory] = useState<HistoryItem[]>(() => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] } })
  const [toast, setToast] = useState('')

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(f => ({ ...f, [key]: value }))
  const show = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 1800) }

  const loadRates = async () => {
    if (form.manualRate) {
      setRates({ rates: { ...fallbackRates, [form.renewalCurrency]: 1, [form.tradeCurrency]: Number(form.manualRate) }, base: form.renewalCurrency, source: 'manual', provider: '手动汇率', updatedAt: new Date().toISOString() })
      return
    }
    const cached = localStorage.getItem(RATE_KEY)
    try {
      const data = await getJson('https://open.er-api.com/v6/latest/USD')
      if (data?.rates) {
        const next = { rates: Object.fromEntries(currencies.map(c => [c, Number(data.rates[c] || fallbackRates[c])])) as Partial<Record<Currency, number>>, base: 'USD' as Currency, source: 'live' as const, provider: 'open.er-api.com', updatedAt: data.time_last_update_utc || new Date().toISOString() }
        setRates(next); localStorage.setItem(RATE_KEY, JSON.stringify({ ...next, cachedAt: Date.now() })); return
      }
      throw new Error('invalid response')
    } catch (e) {
      try {
        const data = await getJson('https://api.exchangerate-api.com/v4/latest/USD')
        if (data?.rates) {
          const next = { rates: Object.fromEntries(currencies.map(c => [c, Number(data.rates[c] || fallbackRates[c])])) as Partial<Record<Currency, number>>, base: 'USD' as Currency, source: 'live' as const, provider: 'exchangerate-api.com', updatedAt: data.date || new Date().toISOString() }
          setRates(next); localStorage.setItem(RATE_KEY, JSON.stringify({ ...next, cachedAt: Date.now() })); return
        }
      } catch { /* fallback */ }
      if (cached) {
        const c = JSON.parse(cached)
        setRates({ ...c, source: 'cache', error: String(e) })
      } else {
        setRates({ rates: fallbackRates, base: 'USD', source: 'fallback', provider: '内置备用汇率', updatedAt: new Date().toISOString(), error: String(e) })
      }
    }
  }

  useEffect(() => { loadRates() }, [form.manualRate, form.renewalCurrency, form.tradeCurrency])
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(form)) }, [form])

  const calc = useMemo(() => {
    const totalDays = form.billingCycle === 'custom' ? Math.max(1, Number(form.customDays) || 1) : cycleDays[form.billingCycle]
    const remainingDays = Math.max(0, daysBetween(form.tradeDate, form.expiryDate))
    const usedDays = Math.max(0, totalDays - remainingDays)
    const daily = (Number(form.renewalPrice) || 0) / totalDays
    const rawRemaining = daily * remainingDays
    const converted = convert(rawRemaining, form.renewalCurrency, form.tradeCurrency, rates.rates)
    const push = form.feeBearer === 'buyer' ? Number(form.pushFee) || 0 : 0
    let finalPrice = form.targetPrice !== '' && Number(form.targetPrice) > 0 ? Number(form.targetPrice) : converted + (Number(form.premium) || 0) + push
    finalPrice = applyRound(finalPrice, form.roundMode)
    const impliedPremium = finalPrice - converted - push
    const rate = convert(1, form.renewalCurrency, form.tradeCurrency, rates.rates)
    return { totalDays, remainingDays, usedDays, daily, rawRemaining, converted, push, finalPrice, impliedPremium, rate, percent: totalDays ? remainingDays / totalDays * 100 : 0 }
  }, [form, rates])

  const shareText = `VPS 剩余价值计算结果\n商家：${form.provider || '-'}\n套餐：${form.plan || '-'}\n续费：${money(form.renewalPrice, form.renewalCurrency)} / ${cycleLabel[form.billingCycle]}\n到期：${form.expiryDate}\n剩余：${calc.remainingDays} 天\n剩余价值：${money(calc.converted, form.tradeCurrency)}\n建议售价：${money(calc.finalPrice, form.tradeCurrency)}`
  const shareMarkdown = `## VPS 剩余价值计算结果\n\n- 商家：${form.provider || '-'}\n- 套餐：${form.plan || '-'}\n- 地区：${form.region || '-'}\n- 续费：${money(form.renewalPrice, form.renewalCurrency)} / ${cycleLabel[form.billingCycle]}\n- 到期时间：${form.expiryDate}\n- 剩余天数：${calc.remainingDays} 天\n- 剩余价值：${money(calc.converted, form.tradeCurrency)}\n- 建议售价：**${money(calc.finalPrice, form.tradeCurrency)}**\n\n> 汇率：1 ${form.renewalCurrency} = ${calc.rate.toFixed(4)} ${form.tradeCurrency}，来源：${rates.provider}`
  const tradePost = `## [出] ${form.provider || 'VPS'} ${form.plan || ''} ${form.region || ''} ${money(calc.finalPrice, form.tradeCurrency)}\n\n### 基本信息\n\n- 商家：${form.provider || '-'}\n- 套餐：${form.plan || '-'}\n- 地区：${form.region || '-'}\n- CPU：${form.cpu || '-'}\n- 内存：${form.ram || '-'}\n- 硬盘：${form.storage || '-'}\n- 带宽：${form.bandwidth || '-'}\n- 流量：${form.traffic || '-'}\n- IP：${form.ip || '-'}\n- 标签：${form.tags || '-'}\n\n### 价格信息\n\n- 续费价格：${money(form.renewalPrice, form.renewalCurrency)} / ${cycleLabel[form.billingCycle]}\n- 到期时间：${form.expiryDate}\n- 剩余天数：${calc.remainingDays} 天\n- 估算剩余价值：${money(calc.converted, form.tradeCurrency)}\n- 出售价：**${money(calc.finalPrice, form.tradeCurrency)}**\n- 转移费：${Number(form.pushFee) ? `${money(Number(form.pushFee), form.tradeCurrency)}（${feeBearerLabel[form.feeBearer]}）` : '无/未填写'}\n\n### 转移方式\n\n- 转移方式：${form.transferMethod || '-'}\n- 联系方式：${form.contact || '-'}\n${form.testUrl ? `- 测速/探针：${form.testUrl}\n` : ''}\n### 备注\n\n${form.notes || '-'}\n\n> 剩余价值由 VPS 剩余价值计算器生成，仅供参考。`

  const copy = async (text: string, msg = '已复制') => { await navigator.clipboard.writeText(text); show(msg) }
  const saveHistory = () => {
    const item = { id: crypto.randomUUID(), time: new Date().toLocaleString(), provider: form.provider, plan: form.plan, finalPrice: calc.finalPrice, currency: form.tradeCurrency, remainingDays: calc.remainingDays }
    const next = [item, ...history].slice(0, 10); setHistory(next); localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); show('已保存到历史')
  }
  const copyUrl = () => copy(`${location.origin}${location.pathname}?data=${encodeShare(form)}`, '分享链接已复制')
  const exportImage = async () => {
    if (!resultRef.current) return
    const canvas = await html2canvas(resultRef.current, { scale: 2, backgroundColor: '#ffffff' })
    const a = document.createElement('a'); a.download = 'vps-value-result.png'; a.href = canvas.toDataURL('image/png'); a.click(); show('图片已生成')
  }

  return <main className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="VPS 剩余价值计算器">
        <span className="brand-mark"><Server size={18}/></span>
        <span>VPS 价值计算器</span>
      </a>
      <div className="topbar-actions">
        <span className={`rate-pill ${rates.source}`}>1 {form.renewalCurrency} = {calc.rate.toFixed(4)} {form.tradeCurrency}</span>
        <button className="secondary compact" onClick={loadRates}><RefreshCw size={15}/>刷新汇率</button>
      </div>
    </header>

    <section className="intro">
      <p className="eyebrow">剩余价值 · 交易文案</p>
      <h1>VPS 余值精准估算<br/>交易文案一键生成</h1>
      <p className="lead">基于续费周期、剩余时间与汇率，生成清晰可信的交易参考价。</p>
      <div className="trust-badges" aria-label="工具特性">
        <span>本地计算，不上传数据</span>
        <span>自动 / 手动汇率</span>
        <span>一键复制交易文案</span>
      </div>
    </section>

    <section className="workspace">
      <div className="panel form-panel">
        <div className="panel-heading">
          <p className="eyebrow">输入</p>
          <h2><Calculator size={19}/>计算信息</h2>
        </div>

        <div className="section-block">
          <h3>价格与周期</h3>
          <div className="field-grid two">
            <Input label="续费金额" type="number" value={form.renewalPrice} onChange={v=>update('renewalPrice', Number(v))}/>
            <Select label="续费币种" value={form.renewalCurrency} onChange={v=>update('renewalCurrency', v as Currency)} options={currencies} labels={currencyLabel}/>
            <CycleButtons value={form.billingCycle} onChange={v=>update('billingCycle', v)} />
            {form.billingCycle === 'custom' && <Input label="自定义天数" type="number" value={form.customDays} onChange={v=>update('customDays', Number(v))}/>}
            <Input label="到期日期" type="date" value={form.expiryDate} onChange={v=>update('expiryDate', v)}/>
            <Input label="交易日期" type="date" value={form.tradeDate} onChange={v=>update('tradeDate', v)}/>
          </div>
        </div>

        <div className="section-block">
          <h3>交易修正</h3>
          <div className="field-grid two">
            <Select label="交易币种" value={form.tradeCurrency} onChange={v=>update('tradeCurrency', v as Currency)} options={currencies} labels={currencyLabel}/>
            <Input label="手动汇率（可空）" type="number" value={form.manualRate} onChange={v=>update('manualRate', v ? Number(v) : '')}/>
            <Input label="溢价/折价" type="number" value={form.premium} onChange={v=>update('premium', Number(v))} placeholder="溢价填正数，折价填负数"/>
            <Input label="目标成交价" type="number" value={form.targetPrice} onChange={v=>update('targetPrice', v ? Number(v) : '')} placeholder="填写后覆盖建议售价"/>
            <Input label="转移费" type="number" value={form.pushFee} onChange={v=>update('pushFee', Number(v))}/>
            <Select label="转移费承担" value={form.feeBearer} onChange={v=>update('feeBearer', v as FeeBearer)} options={['buyer','seller']} labels={feeBearerLabel}/>
            <Select label="取整方式" value={form.roundMode} onChange={v=>update('roundMode', v as RoundMode)} options={['none','floor','round','ceil']} labels={roundModeLabel}/>
          </div>
          <div className="formula-note">
            <strong>估算公式</strong>
            <span>剩余价值 = 续费金额 × 剩余天数 / 周期天数 × 汇率；转移费仅在买家承担时计入建议售价，溢价填正数、折价填负数。</span>
          </div>
        </div>
      </div>

      <aside className="result-stack">
        <div className="panel result-card" ref={resultRef}>
          <div className="result-topline">
            <span>建议售价</span>
            <span>{cycleLabel[form.billingCycle]} · {roundModeLabel[form.roundMode]}</span>
          </div>
          <div className="price">{money(calc.finalPrice, form.tradeCurrency)}</div>
          <div className="progress-label"><span>剩余进度</span><strong>{calc.percent.toFixed(1)}%</strong></div>
          <div className="progress" aria-label={`剩余比例 ${calc.percent.toFixed(1)}%`}><i style={{ width: `${Math.min(100, Math.max(0, calc.percent))}%` }}/></div>
          <div className="stat-grid">
            <div><strong>{calc.remainingDays}</strong><span>剩余天数</span></div>
            <div><strong>{calc.percent.toFixed(1)}%</strong><span>剩余比例</span></div>
            <div><strong>{currencySymbol[form.renewalCurrency]}{calc.daily.toFixed(2)}</strong><span>{currencyLabel[form.renewalCurrency].split(' ')[1]} / 天</span></div>
          </div>
          <dl className="metrics">
            <div><dt>周期天数</dt><dd>{calc.totalDays} 天</dd></div>
            <div><dt>原币剩余</dt><dd>{money(calc.rawRemaining, form.renewalCurrency)}</dd></div>
            <div><dt>折算价值</dt><dd>{money(calc.converted, form.tradeCurrency)}</dd></div>
            <div><dt>溢价/折价</dt><dd>{money(calc.impliedPremium, form.tradeCurrency)}</dd></div>
          </dl>
          <div className="rate-inline" aria-label="汇率状态">
            <span>汇率来源</span>
            <strong>{rates.provider}</strong>
            <small>{rateSourceLabel[rates.source]}{rates.error ? ' · 汇率接口失败，已降级' : ''}</small>
          </div>
        </div>
        <div className="quick-actions">
          <button onClick={()=>copy(shareMarkdown)}><Copy size={16}/>Markdown</button>
          <button className="secondary" onClick={()=>copy(shareText)}><Copy size={16}/>纯文本</button>
          <button className="secondary" onClick={copyUrl}><Link size={16}/>链接</button>
          <button className="secondary" onClick={exportImage}><ImageDown size={16}/>图片</button>
          <button className="secondary" onClick={saveHistory}><History size={16}/>保存</button>
        </div>
      </aside>
    </section>

    <section className="panel sell-panel">
      <div className="panel-heading inline">
        <div><p className="eyebrow">交易信息</p><h2>交易信息</h2></div>
        <p className="muted">商家、套餐、配置与联系方式用于生成交易文案，不影响核心估值。</p>
      </div>
      <div className="field-grid three">
        <Input label="商家" value={form.provider} onChange={v=>update('provider', v)} placeholder="如 RackNerd" />
        <Input label="套餐" value={form.plan} onChange={v=>update('plan', v)} placeholder="如 2C2G 30G SSD" />
        <Input label="地区" value={form.region} onChange={v=>update('region', v)} placeholder="如 洛杉矶 DC02" />
      </div>
      <div className="field-grid six specs">
        <Input label="CPU" value={form.cpu} onChange={v=>update('cpu', v)}/>
        <Input label="内存" value={form.ram} onChange={v=>update('ram', v)}/>
        <Input label="硬盘" value={form.storage} onChange={v=>update('storage', v)}/>
        <Input label="带宽" value={form.bandwidth} onChange={v=>update('bandwidth', v)}/>
        <Input label="流量" value={form.traffic} onChange={v=>update('traffic', v)}/>
        <Input label="IP" value={form.ip} onChange={v=>update('ip', v)}/>
      </div>
      <Input label="标签" value={form.tags} onChange={v=>update('tags', v)} placeholder="CN2, 原生IP, 解锁"/>
      <div className="field-grid two">
        <Input label="转移方式" value={form.transferMethod} onChange={v=>update('transferMethod', v)}/>
        <Input label="联系方式" value={form.contact} onChange={v=>update('contact', v)}/>
      </div>
      <Input label="测速/探针" value={form.testUrl} onChange={v=>update('testUrl', v)}/>
      <label><span>备注</span><textarea value={form.notes} onChange={e=>update('notes', e.target.value)} placeholder="补充说明"/></label>
    </section>

    <section className="output-grid">
      <div className="panel markdown-panel">
        <div className="panel-heading inline">
          <div><p className="eyebrow">输出</p><h2>交易文案</h2></div>
          <div className="actions"><button onClick={()=>copy(tradePost, '交易文案已复制')}><Copy size={16}/>复制</button><button className="secondary" onClick={()=>copy(tradePost.replaceAll('#','').replaceAll('*',''), '纯文本已复制')}><Copy size={16}/>纯文本</button></div>
        </div>
        <textarea className="post" readOnly value={tradePost}/>
      </div>
      <div className="panel history-panel">
        <div className="panel-heading inline">
          <div><p className="eyebrow">本地记录</p><h2>历史记录</h2></div>
          <button className="secondary icon-only" onClick={()=>{setHistory([]); localStorage.removeItem(HISTORY_KEY)}} aria-label="清空历史"><Trash2 size={16}/></button>
        </div>
        {history.length === 0 ? <p className="empty">暂无历史。数据仅保存在当前浏览器。</p> : <ul className="history">{history.map(h=><li key={h.id}><span>{h.provider || 'VPS'} {h.plan}</span><strong>{money(h.finalPrice, h.currency)}</strong><small>{h.time} · {h.remainingDays} 天</small></li>)}</ul>}
      </div>
    </section>

    <footer>数据仅供参考；汇率来自免费公开接口，失败时自动使用缓存或备用汇率。</footer>
    {toast && <div className="toast">{toast}</div>}
  </main>
}


function CycleButtons({ value, onChange }: { value: Cycle, onChange: (v: Cycle)=>void }) {
  const options = (Object.keys(cycleLabel) as Cycle[]).filter(o => o !== 'custom')
  return <fieldset className="cycle-field"><legend>计费周期</legend><div className="cycle-buttons">{options.map(o=><button key={o} type="button" className={value === o ? 'active' : ''} onClick={()=>onChange(o)}>{cycleLabel[o]}</button>)}<button type="button" className={value === 'custom' ? 'active' : ''} onClick={()=>onChange('custom')}>自定义</button></div></fieldset>
}

function Input({ label, value, onChange, type='text', placeholder='' }: { label: string, value: string | number, onChange: (v: string)=>void, type?: string, placeholder?: string }) {
  return <label className="field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={e=>onChange(e.target.value)}/></label>
}
function Select({ label, value, onChange, options, labels }: { label: string, value: string, onChange: (v: string)=>void, options: string[], labels?: Record<string, string> }) {
  return <label className="field"><span>{label}</span><select value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o} value={o}>{labels?.[o] || cycleLabel[o as Cycle] || o}</option>)}</select></label>
}
export default App
