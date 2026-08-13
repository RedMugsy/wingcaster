/**
 * White-label helpers: listing import, lead routing, widget embeds.
 */

import { v4 as uuidv4 } from 'uuid'
import { findAll, findOne, insert, update } from './db.js'

export function getPublicApiBase() {
  const fromEnv = (process.env.PUBLIC_API_URL || '').replace(/\/$/, '')
  if (fromEnv) return fromEnv
  return 'http://localhost:3001/api'
}

export function getPublicAppBase() {
  return (process.env.PUBLIC_APP_URL || 'http://localhost:7100').replace(/\/$/, '')
}

export function generateWidgetEmbed(widgetId, type, config = {}) {
  const api = getPublicApiBase()
  const src = `${api}/public/widgets/${widgetId}.js`
  const attrs = [`src="${src}"`, 'async']
  if (type === 'listing-gallery') {
    attrs.push(`data-theme="${config.theme || 'light'}"`)
    attrs.push(`data-limit="${config.limit || 6}"`)
  } else if (type === 'search-bar') {
    attrs.push(`data-placeholder="${config.placeholder || 'Search properties...'}"`)
  } else if (type === 'contact-form') {
    attrs.push(`data-agency="${config.agency_name || ''}"`)
  } else if (type === 'mortgage-calculator') {
    attrs.push(`data-currency="${config.currency || 'USD'}"`)
  }
  return `<script ${attrs.join(' ')}></script>`
}

function normalizeListingInput(raw, defaults = {}) {
  const photos = Array.isArray(raw.photos)
    ? raw.photos
    : String(raw.photos || raw.images || '')
        .split(/[|,]/)
        .map((s) => s.trim())
        .filter(Boolean)
  const amenities = Array.isArray(raw.amenities)
    ? raw.amenities
    : String(raw.amenities || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

  return {
    title: raw.title || raw.name || 'Imported listing',
    description: raw.description || raw.summary || '',
    type: raw.type === 'rent' || raw.listing_type === 'rent' ? 'rent' : 'sale',
    property_type: raw.property_type || raw.propertyType || 'apartment',
    price: Number(raw.price) || 0,
    price_unit: raw.price_unit || (raw.type === 'rent' ? 'month' : undefined),
    bedrooms: Number(raw.bedrooms ?? raw.beds ?? 0),
    bathrooms: Number(raw.bathrooms ?? raw.baths ?? 0),
    area: Number(raw.area ?? raw.size ?? 0),
    area_unit: raw.area_unit || 'sqm',
    location: raw.location || raw.address || '',
    city: raw.city || '',
    neighborhood: raw.neighborhood || raw.area_name || '',
    photos,
    amenities,
    status: raw.status || 'active',
    featured: raw.featured ? 1 : 0,
    external_id: String(raw.external_id || raw.id || raw.ref || ''),
    ...defaults,
  }
}

/**
 * Import listings into the platform (external → platform source of truth mode).
 * Upserts by external_id + agency when possible.
 */
export async function importListingsForAgency({ agencyId, agentId, agencyName, agentName, agentPhoto, agentLicense, listings, source = 'import' }) {
  const results = { created: 0, updated: 0, skipped: 0, errors: [] }
  const rows = Array.isArray(listings) ? listings : []

  for (const raw of rows) {
    try {
      const normalized = normalizeListingInput(raw, {
        agent_id: agentId,
        agent_name: agentName,
        agent_photo: agentPhoto || '',
        agent_license: agentLicense || '',
        agency_name: agencyName || '',
        agency_id: agencyId,
        source_system: source,
        source_of_truth: 'external',
      })

      if (!normalized.title || !normalized.price) {
        results.skipped += 1
        results.errors.push({ external_id: normalized.external_id, error: 'title and price required' })
        continue
      }

      const existing = normalized.external_id
        ? await findOne(
            'properties',
            (p) =>
              p.external_id === normalized.external_id &&
              (p.agency_id === agencyId || p.agent_id === agentId),
          )
        : null

      const photosStr = normalized.photos.join('|')
      const amenitiesStr = normalized.amenities.join(',')

      if (existing) {
        await update('properties', (p) => p.id === existing.id, (p) => ({
          ...p,
          ...normalized,
          photos: photosStr,
          amenities: amenitiesStr,
          updated_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
        }))
        results.updated += 1
      } else {
        await insert('properties', {
          id: uuidv4(),
          ...normalized,
          photos: photosStr,
          amenities: amenitiesStr,
          listed_date: new Date().toISOString().split('T')[0],
          views: 0,
          created_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
        })
        results.created += 1
      }
    } catch (err) {
      results.skipped += 1
      results.errors.push({ error: err.message || String(err) })
    }
  }

  return results
}

export function parseListingsPayload(payload) {
  if (!payload) return []
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload.listings)) return payload.listings
  if (Array.isArray(payload.properties)) return payload.properties
  if (Array.isArray(payload.data)) return payload.data
  return []
}

export function parseSimpleXmlProperties(xml) {
  const listings = []
  const blocks = String(xml).match(/<property[\s\S]*?<\/property>/gi) || []
  for (const block of blocks) {
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : ''
    }
    listings.push({
      external_id: get('id') || get('external_id') || get('ref'),
      title: get('title') || get('name'),
      description: get('description'),
      price: get('price'),
      type: get('type') || get('listing_type'),
      property_type: get('property_type'),
      location: get('location') || get('address'),
      city: get('city'),
      neighborhood: get('neighborhood'),
      bedrooms: get('bedrooms'),
      bathrooms: get('bathrooms'),
      area: get('area'),
      photos: get('photos') || get('image'),
    })
  }
  return listings
}

export async function resolveLeadAgent({ agencyId, propertyId, source, preferredAgentId }) {
  if (preferredAgentId) return preferredAgentId
  const prop = propertyId ? await findOne('properties', (p) => p.id === propertyId) : null
  if (prop?.agent_id) return prop.agent_id

  const rules = (await findAll('lead_routing_rules', (r) => r.agency_id === agencyId))
    .slice()
    .sort((a, b) => (a.priority || 99) - (b.priority || 99))

  for (const rule of rules) {
    const cond = String(rule.condition || '')
    if (!cond) return rule.assign_to
    if (cond.startsWith('source:') && source && cond.slice(7) === source) return rule.assign_to
    if (cond === 'source:website' && (source === 'agency_website' || source === 'widget')) return rule.assign_to
    if (prop) {
      if (cond.startsWith('type:') && prop.type === cond.slice(5)) return rule.assign_to
      if (cond.startsWith('location:') && String(prop.city || prop.location || '').includes(cond.slice(9))) {
        return rule.assign_to
      }
      if (cond.startsWith('price:>') && prop.price > Number(cond.slice(7))) return rule.assign_to
    }
  }

  const agency = agencyId ? await findOne('agencies', (a) => a.id === agencyId) : null
  return agency?.owner_id || null
}

export async function getAgencyInventory(agencyId) {
  const members = await findAll('agency_members', (m) => m.agency_id === agencyId && m.status === 'active')
  const memberIds = members.map((m) => m.user_id)
  return await findAll('properties', (p) => memberIds.includes(p.agent_id) || p.agency_id === agencyId)
}

export function buildWidgetBootstrapScript(widget, { listings, agency, appBase, apiBase }) {
  const config = typeof widget.config === 'string' ? JSON.parse(widget.config || '{}') : (widget.config || {})
  const payload = {
    id: widget.id,
    type: widget.type,
    config,
    agency: agency
      ? { id: agency.id, name: agency.name, phone: agency.phone, email: agency.email, primary_color: agency.primary_color }
      : null,
    listings: (listings || []).slice(0, Number(config.limit) || 6).map((p) => ({
      id: p.id,
      title: p.title,
      price: p.price,
      type: p.type,
      location: p.location,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      area: p.area,
      photo: Array.isArray(p.photos) ? p.photos[0] : String(p.photos || '').split('|')[0],
      url: `${appBase}/property/${p.id}`,
    })),
    apiBase,
    appBase,
  }

  return `(function(){
  var DATA = ${JSON.stringify(payload)};
  var s = document.currentScript;
  var root = document.createElement('div');
  root.id = 'reb-widget-' + DATA.id;
  root.setAttribute('data-reb-widget', DATA.type);
  if (s && s.parentNode) s.parentNode.insertBefore(root, s.nextSibling);
  else document.body.appendChild(root);

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function(k){
      if (k === 'style' && typeof attrs[k] === 'object') Object.assign(n.style, attrs[k]);
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function(c){ if (c) n.appendChild(c); });
    return n;
  }

  var primary = (DATA.agency && DATA.agency.primary_color) || '#0f172a';
  var theme = (DATA.config && DATA.config.theme) || 'light';
  root.style.cssText = 'font-family:system-ui,-apple-system,sans-serif;color:' + (theme==='dark'?'#f8fafc':'#0f172a') + ';background:' + (theme==='dark'?'#0f172a':'#fff') + ';';

  if (DATA.type === 'listing-gallery') {
    var grid = el('div', { style: { display:'grid', gap:'12px', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))' } });
    (DATA.listings || []).forEach(function(p){
      var card = el('a', { href: p.url, target: '_blank', rel:'noopener', style: { textDecoration:'none', color:'inherit', border:'1px solid #e2e8f0', borderRadius:'12px', overflow:'hidden', display:'block' } }, [
        el('div', { style: { aspectRatio:'4/3', background:'#e2e8f0', backgroundImage: p.photo ? 'url('+p.photo+')' : 'none', backgroundSize:'cover', backgroundPosition:'center' } }),
        el('div', { style: { padding:'12px' } }, [
          el('div', { style: { fontWeight:'600', fontSize:'14px', marginBottom:'4px' }, text: p.title }),
          el('div', { style: { fontSize:'12px', color:'#64748b' }, text: p.location || '' }),
          el('div', { style: { marginTop:'8px', fontWeight:'700', color: primary }, text: (p.type==='rent'?'$'+Number(p.price).toLocaleString()+'/mo':'$'+Number(p.price).toLocaleString()) })
        ])
      ]);
      grid.appendChild(card);
    });
    if (!DATA.listings.length) root.appendChild(el('p', { text: 'No listings available.', style: { color:'#64748b' } }));
    else root.appendChild(grid);
  } else if (DATA.type === 'search-bar') {
    var form = el('form', { style: { display:'flex', gap:'8px' } });
    var input = el('input', { type:'search', placeholder: (DATA.config && DATA.config.placeholder) || 'Search properties...', style: { flex:'1', padding:'10px 12px', border:'1px solid #cbd5e1', borderRadius:'8px' } });
    var btn = el('button', { type:'submit', style: { background: primary, color:'#fff', border:'0', borderRadius:'8px', padding:'10px 16px', cursor:'pointer' }, text: 'Search' });
    form.appendChild(input); form.appendChild(btn);
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var q = encodeURIComponent(input.value || '');
      window.open(DATA.appBase + '/search?search=' + q, '_blank');
    });
    root.appendChild(form);
  } else if (DATA.type === 'contact-form') {
    var box = el('form', { style: { display:'grid', gap:'8px', maxWidth:'420px' } });
    var fields = [
      { name:'name', placeholder:'Your name', required:true },
      { name:'email', placeholder:'Email', required:true },
      { name:'phone', placeholder:'Phone' },
    ];
    var inputs = {};
    fields.forEach(function(f){
      var i = el('input', { name:f.name, placeholder:f.placeholder, required: !!f.required, style: { padding:'10px 12px', border:'1px solid #cbd5e1', borderRadius:'8px' } });
      inputs[f.name] = i; box.appendChild(i);
    });
    var msg = el('textarea', { name:'message', placeholder:'Message', rows:'4', required:'true', style: { padding:'10px 12px', border:'1px solid #cbd5e1', borderRadius:'8px' } });
    box.appendChild(msg);
    var status = el('div', { style: { fontSize:'13px', color:'#64748b' } });
    var submit = el('button', { type:'submit', style: { background: primary, color:'#fff', border:'0', borderRadius:'8px', padding:'10px 16px', cursor:'pointer' }, text: 'Send inquiry' });
    box.appendChild(submit); box.appendChild(status);
    box.addEventListener('submit', function(e){
      e.preventDefault();
      status.textContent = 'Sending...';
      fetch(DATA.apiBase + '/inquiries', {
        method:'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          name: inputs.name.value,
          email: inputs.email.value,
          phone: inputs.phone.value,
          message: msg.value,
          agency_id: DATA.agency && DATA.agency.id,
          source: 'widget',
          channel: 'web',
          property_title: 'Widget inquiry: ' + ((DATA.agency && DATA.agency.name) || 'Agency')
        })
      }).then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j.error||'Failed'); return j; }); })
        .then(function(){ status.textContent = 'Thanks — we will contact you soon.'; box.reset(); })
        .catch(function(err){ status.textContent = err.message || 'Failed to send'; });
    });
    root.appendChild(box);
  } else if (DATA.type === 'mortgage-calculator') {
    var currency = (DATA.config && DATA.config.currency) || 'USD';
    var wrap = el('div', { style: { display:'grid', gap:'8px', maxWidth:'360px' } });
    var price = el('input', { type:'number', value:'500000', style: { padding:'10px 12px', border:'1px solid #cbd5e1', borderRadius:'8px' } });
    var rate = el('input', { type:'number', value:'5.5', step:'0.1', style: { padding:'10px 12px', border:'1px solid #cbd5e1', borderRadius:'8px' } });
    var years = el('input', { type:'number', value:'20', style: { padding:'10px 12px', border:'1px solid #cbd5e1', borderRadius:'8px' } });
    var out = el('div', { style: { fontWeight:'700', color: primary, fontSize:'18px' }, text: '-' });
    function calc(){
      var P = Number(price.value)||0, r = (Number(rate.value)||0)/100/12, n = (Number(years.value)||0)*12;
      var m = r === 0 ? (n ? P/n : 0) : P * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1);
      out.textContent = currency + ' ' + Math.round(m).toLocaleString() + ' / month';
    }
    ;[price,rate,years].forEach(function(i){ i.addEventListener('input', calc); wrap.appendChild(i); });
    wrap.appendChild(out); calc();
    root.appendChild(wrap);
  } else {
    root.appendChild(el('p', { text: 'Unknown widget type' }));
  }
})();`
}
