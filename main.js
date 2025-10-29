void (async function CHROME_THEME_SPA_MAIN_v4() {
    const HOST_ID = 'chrome-theme-spa-host';
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('section');
      host.id = HOST_ID;
      document.body.appendChild(host);
    }
    for (const el of [...document.body.children]) if (el !== host) el.remove();
    Object.assign(document.documentElement.style, {height:'100%'});
    Object.assign(document.body.style, {height:'100%',margin:'0',background:'#0f1116',color:'#e8eaed',font:'14px/1.4 system-ui,Segoe UI,Roboto,sans-serif'});
  
    const root = host.attachShadow?.({mode:'open'}) ?? host;
  
    const [
      {ThemeColorPickerBrowserProxy},
      {BrowserColorVariant},
      {CustomizeChromeApiProxy},
      {CustomizeToolbarApiProxy},
    ] = await Promise.all([
      import('chrome://resources/cr_components/theme_color_picker/browser_proxy.js'),
      import('chrome://resources/mojo/ui/base/mojom/themes.mojom-webui.js'),
      import('chrome://customize-chrome-side-panel.top-chrome/customize_chrome_api_proxy.js'),
      import('chrome://customize-chrome-side-panel.top-chrome/customize_toolbar/customize_toolbar_api_proxy.js'),
    ]);
  
    const picker = ThemeColorPickerBrowserProxy.getInstance();
    const customize = CustomizeChromeApiProxy.getInstance();
    const H = customize.handler;
  
    const TBProxy = CustomizeToolbarApiProxy.getInstance();
    const TBH = TBProxy.handler;
  
    if (!window.__chromeThemeToolboxLoaded) {
      window.__chromeThemeToolboxLoaded = true;
  
      const SkColor = (r,g,b,a=255)=>({ value: ((a&255)<<24)|((r&255)<<16)|((g&255)<<8)|(b&255) });
      const clamp8 = x => Math.max(0, Math.min(255, x|0));
      const toHex = (r,g,b) => '#' + [r,g,b].map(v => ('0'+clamp8(v).toString(16)).slice(-2)).join('');
      const hexToSk = (hex) => {
        let s=(hex||'').replace('#','').trim();
        if (s.length===3) s=s[0]+s[0]+s[1]+s[1]+s[2]+s[2];
        const n=parseInt(s,16); return SkColor((n>>16)&255,(n>>8)&255,n&255,255);
      };
  
      const waiters=[]; let listening=false;
      function installSetThemeOnce(){
        if (listening) return;
        customize.callbackRouter.setTheme.addListener(t=>{
          while(waiters.length){ try{ waiters.shift()(t);}catch{} }
          window.chromeThemeLast=t; console.log('[setTheme]',t);
        });
        listening=true;
      }
      function readThemeOnce(){
        installSetThemeOnce(); try{ H.updateTheme(); }catch{}
        return new Promise(res=>waiters.push(res));
      }
      function variantFrom(x){
        if (typeof x==='number') return x;
        const v=BrowserColorVariant[x];
        return (v===undefined)?BrowserColorVariant.kTonalSpot:v;
      }
      async function ensureEditable(){ try{H.setFollowDeviceTheme(false);}catch{} try{H.updateThemeEditable(true);}catch{} }
  
      async function setSeed(hex,variant='kTonalSpot'){
        await ensureEditable();
        try{ picker.handler.setSeedColor(hexToSk(hex),variantFrom(variant)); }catch(e){console.error('setSeedColor failed',e);}
        try{ H.updateTheme(); }catch{}
        return readThemeOnce();
      }
      async function setVariant(variant='kTonalSpot'){
        await ensureEditable();
        const t=await readThemeOnce();
        const seed = t?.seedColor!=null ? {value:t.seedColor}:null;
        if(!seed){ console.warn('No seed found. Set a seed first.'); return t; }
        try{ picker.handler.setSeedColor(seed,variantFrom(variant)); }catch(e){console.error('setVariant failed',e);}
        try{ H.updateTheme(); }catch{}
        return readThemeOnce();
      }
      async function followDevice(on){ try{H.setFollowDeviceTheme(!!on);}catch{} return readThemeOnce(); }
      async function setClassic(){ try{H.removeBackgroundImage();}catch{} try{H.setDefaultColor();}catch{} return readThemeOnce(); }
  
      async function listCollections(){ const {collections}=await H.getBackgroundCollections(); return collections; }
      async function listImages(collectionId){ const {images}=await H.getBackgroundImages(collectionId); return images; }
  
      async function applyImageByLabel(regex=/./i,index=0){
        const {collections}=await H.getBackgroundCollections();
        const col = collections.find(c=>regex.test(c.label))||collections[0]; if(!col) return null;
        const {images}=await H.getBackgroundImages(col.id);
        const img=images[index|0]; if(!img) return null;
        try{
          H.setBackgroundImage(
            img.attribution1||'',img.attribution2||'',
            img.attributionUrl?.url?{url:img.attributionUrl.url}:{url:''},
            img.imageUrl?.url?{url:img.imageUrl.url}:{url:img.imageUrl},
            img.previewImageUrl?.url?{url:img.previewImageUrl.url}:{url:(img.previewImageUrl||img.imageUrl)},
            col.id
          );
        }catch(e){console.error('applyImageByLabel failed',e);}
        try{H.updateTheme();}catch{}
        return readThemeOnce();
      }
      async function setDailyRefresh(regex=/./i,enabled=true){
        const {collections}=await H.getBackgroundCollections();
        const col=collections.find(c=>regex.test(c.label));
        const id=(enabled&&col)?col.id:''; try{H.setDailyRefreshCollectionId(id);}catch{} return readThemeOnce();
      }
      async function clearBackground(){ try{H.removeBackgroundImage();}catch{} return readThemeOnce(); }
  
      function deepQueryAll(root,selectorList,maxDepth=10){
        const out=new Set(), seen=new Set();
        (function walk(n,d){ if(!n||d>maxDepth||seen.has(n)) return; seen.add(n);
          try{ for(const sel of selectorList) n.querySelectorAll?.(sel)?.forEach(e=>out.add(e)); }catch{}
          if(n.shadowRoot) walk(n.shadowRoot,d+1);
          n.childNodes?.forEach(ch=>walk(ch,d+1));
        })(root,0); return [...out];
      }
      function extractUrlFromStyle(str){ if(!str) return ''; const m=String(str).match(/url\((["'])?([^"')]+)\1\)/i); return m?m[2]:''; }
      function findSidePanelPreviewUrl(){
        const cand=deepQueryAll(document,[
          '[style*="background-image"]','.preview,.mini-ntp,.theme-swatch,.tile,.card,.bg,.background','img'
        ],12);
        for(const el of cand){ const cs=getComputedStyle(el); const u=extractUrlFromStyle(cs.backgroundImage||cs.background||''); if(u && /^(chrome-untrusted|chrome|blob|data|https?):/i.test(u)) return u; }
        for(const el of cand){ if(el.tagName==='IMG' && el.src) return el.src; } return '';
      }
      async function dumpTheme(){ const t=await readThemeOnce(); console.log('Theme snapshot:',t); return t; }
      async function getCurrentBackgroundUrl(){
        let t=null; try{t=await dumpTheme();}catch{}
        const paths=[
          ['backgroundImage','backgroundImageUrl','url'],['backgroundImage','previewImageUrl','url'],['backgroundImage','imageUrl','url'],['backgroundImage','attributionUrl','url'],
          ['backgroundImage','backgroundImageUrl'],['backgroundImage','previewImageUrl'],['backgroundImage','imageUrl'],['backgroundImage','attributionUrl'],
          ['imageUrl','url'],['imageUrl'],['previewImageUrl','url'],['previewImageUrl']
        ];
        const dig=(o,p)=>p.reduce((a,k)=>(a&&k in a)?a[k]:undefined,o);
        for(const p of paths){ const v=t&&dig(t,p); if(typeof v==='string'&&v) return v; if(v && typeof v.url==='string'&&v.url) return v.url; }
        const u=findSidePanelPreviewUrl(); if(u) return u; return '';
      }
      async function harmonizeFromImage(url){
        const img=new Image(); img.crossOrigin='anonymous';
        const loaded=new Promise((res,rej)=>{img.onload=res; img.onerror=rej;});
        img.src=url; try{await loaded;}catch(e){console.warn('Image load/CORS issue',e); return null;}
        const W=64,Hh=64, c=document.createElement('canvas'); c.width=W; c.height=Hh;
        const ctx=c.getContext('2d',{willReadFrequently:true}); ctx.drawImage(img,0,0,W,Hh);
        const data=ctx.getImageData(0,0,W,Hh).data; let r=0,g=0,b=0,cnt=0;
        for(let i=0;i<data.length;i+=4){ r+=data[i]; g+=data[i+1]; b+=data[i+2]; cnt++; }
        const hex=toHex((r/cnt)|0,(g/cnt)|0,(b/cnt)|0); console.log('Derived seed:',hex);
        return setSeed(hex,'kTonalSpot');
      }
      async function harmonizeFromCurrentBackground(){ const u=await getCurrentBackgroundUrl().catch(()=>null); if(!u){console.warn('No current background URL'); return null;} return harmonizeFromImage(u); }
      async function harmonizeFromFile(file){ if(!(file instanceof File)) throw new TypeError('Expected a File'); const u=URL.createObjectURL(file); try{ return await harmonizeFromImage(u);} finally{ URL.revokeObjectURL(u);} }
  
      async function scanToolbarPinnables() {
        const [{actions}, {categories}, customizedResp] = await Promise.all([
          TBH.listActions(), TBH.listCategories(), TBH.getIsCustomized?.().catch(()=>({customized:false}))
        ]);
        const customized = !!(customizedResp?.customized);
        const catById = new Map(categories.map(c => [c.id, c.displayName]));
        const table = (actions||[]).map(a => ({
          id: a.id, name: a.displayName, categoryId: a.category,
          category: catById.get(a.category)||'', pinned: !!a.pinned,
          enterpriseLocked: !!a.hasEnterpriseControlledPinnedState,
          icon: typeof a.iconUrl==='string'?a.iconUrl:(a.iconUrl?.url||'')
        }));
        console.table(table); console.groupEnd();
        return { customized, categories, actions, table };
      }
      async function setActionPinned(id, pinned) {
        if (!id) throw new Error('missing id');
        await TBH.pinAction(id, !!pinned);
        const {actions}=await TBH.listActions();
        return actions.find(a=>a.id===id)||null;
      }
      const pinAction = id => setActionPinned(id,true);
      const unpinAction = id => setActionPinned(id,false);
  
      function chromeImage(urlish) {
        let s = typeof urlish === 'string' ? urlish : (urlish?.url || '');
        if (!s) return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
        if (s.startsWith('chrome://image/?')) return s;
        return 'chrome://image/?' + s; // raw URL, no encodeURIComponent
      }
  
      window.chromeTheme = {
        setSeed, setVariant, followDevice, setClassic,
        listCollections, listImages, applyImageByLabel, setDailyRefresh, clearBackground,
        harmonizeFromImage, harmonizeFromFile, harmonizeFromCurrentBackground, getCurrentBackgroundUrl, dumpTheme,
        listVariants: () => { console.table(Object.entries(BrowserColorVariant).filter(([k,v])=>typeof v==='number').map(([k,v])=>({key:k,value:v}))); return BrowserColorVariant; },
        variantsEnum: BrowserColorVariant,
        scanToolbarPinnables, setActionPinned, pinAction, unpinAction,
        chromeImage,
      };
    }
  
    const style = document.createElement('style');
    style.textContent = `
  :host, :host * { box-sizing: border-box; }
  #app { position: fixed; inset: 0; display: grid; grid-template-rows: auto 1fr; background:#0f1116; color:#e8eaed; }
  .header { display:flex; align-items:center; justify-content:space-between; padding:16px 24px;
    border-bottom:1px solid #33384a; background:rgba(17,20,28,.8); backdrop-filter:blur(8px); position:sticky; top:0; z-index:2; }
  .brand { display:flex; align-items:center; gap:12px; }
  .brand .logo { width:12px; height:12px; border-radius:3px; background:#2b447f; box-shadow:0 0 0 4px rgba(43,68,127,.3); }
  .brand .title { font-weight:700; letter-spacing:.2px; }
  .actions { display:flex; gap:8px; flex-wrap:wrap; }
  .btn { border:1px solid #3c4043; background:#1a1d25; color:#e8eaed; border-radius:10px; padding:8px 12px; font-weight:600; cursor:pointer; }
  .btn.primary { border-color:transparent; background:#2b447f; color:#dce2f9; }
  .btn:hover { filter:brightness(1.05); }
  .main { overflow:auto; padding:24px; display:grid; grid-template-columns: repeat(12,minmax(0,1fr)); gap:16px; align-content:start; }
  .card { grid-column: 1 / -1; background:#151822; border:1px solid #33384a; border-radius:14px; padding:16px; box-shadow:0 8px 24px rgba(0,0,0,.28); display:grid; gap:16px; }
  /* halves on wide screens */
  @media (min-width: 900px) { .half { grid-column: span 6; } }
  h3 { margin:0; font-size:16px; font-weight:700; }
  .grid { display:grid; grid-template-columns: 180px 1fr; gap:10px 12px; align-items:center; }
  .input, .select { min-height:36px; border-radius:10px; border:1px solid #3c4043; background:#0f1116; color:#e8eaed; padding:6px 10px; }
  .input[type="color"]{ padding:0; height:36px; border:none; background:transparent; }
  .row{ display:flex; flex-wrap:wrap; gap:8px; }
  .status{ background:#1a1d25; border:1px dashed #3c4043; border-radius:10px; padding:8px 10px; white-space:pre-wrap; min-height:34px; }
  .footer{ text-align:center; opacity:.7; font-size:12px; padding:8px 0 16px; }
  
  /* Wallpaper grid */
  .wall-grid { display:grid; grid-template-columns: repeat(auto-fill,minmax(132px,1fr)); gap:12px; }
  .wall-section { grid-column: 1 / -1; margin-top:6px; font-weight:700; opacity:.9; }
  .wall-tile { display:grid; place-items:center; aspect-ratio:1/1; border:1px solid #3c4043; border-radius:10px; overflow:hidden; cursor:pointer; background:#000; position:relative; }
  .wall-tile img { width:100%; height:100%; object-fit:cover; display:block; }
  .wall-tile.selected { outline:3px solid #b1c5ff; outline-offset:0; }
  
  /* Toolbar Pins */
  .ctp-list{ display:grid; gap:10px; }
  .ctp-cat{ font-weight:700; opacity:.9; margin-top:6px; }
  .ctp-item{ display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid #3c4043; border-radius:10px; background:#0f1116; }
  .ctp-item[aria-disabled="true"]{ opacity:.6; }
  .ctp-item .name{ font-weight:600; }
  .ctp-item .id{ opacity:.7; font-size:12px; }
  .ctp-item .spacer{ flex:1 1 auto; }
  
  /* === Collapsible Sections === */
  .card { position: relative; padding-top: 10px; }
  .card-head {
    display:flex; align-items:center; gap:10px;
    width:100%; text-align:left; cursor:pointer;
    background:transparent; border:none; padding:6px 2px 2px; color:#e8eaed;
    font-weight:700; font-size:16px;
  }
  .card-head .title { flex:1 1 auto; }
  .card-head .chev {
    width:10px; height:10px; border-right:2px solid #aab2c0; border-bottom:2px solid #aab2c0;
    transform: rotate(45deg); transition: transform .18s ease;
  }
  .card[aria-expanded="true"] .chev { transform: rotate(225deg); }
  .card-body { margin-top:10px; }
  .card[aria-expanded="false"] .card-body { display:none; }
  .card .subtle { opacity:.8; font-weight:600; }
  `;
    root.appendChild(style);
  
    const el = (t,c,txt)=>{ const e=document.createElement(t); if(c) e.className=c; if(txt!=null) e.textContent=txt; return e; };
    const input = (id,type='text',val='')=>{ const i=el('input','input'); i.id=id; i.type=type; if(val!==undefined) i.value=val; return i; };
    const select = id => el('select','select');
    const btn = (text, cls='btn') => el('button',cls,text);
  
    const app = el('div','app'); app.id='app';
    const header = el('header','header');
    const brand = el('div','brand'); brand.append(el('div','logo'), el('div','title','Chrome Theme Toolkit'));
    const hdrActions = el('div','actions'); const bDumpTop = btn('Dump Theme'); hdrActions.append(bDumpTop);
    header.append(brand,hdrActions);
  
    const main = el('main','main');
  
    const cardA = el('section','card'); cardA.append(el('h3',null,'Seed & Variant'));
    const gridA = el('div','grid');
    const inHex = input('seed-hex','text','#8a2be2'); const inColor = input('seed-color','color','#8a2be2'); const selVar = select('seed-variant');
    gridA.append(el('label',null,'Seed Hex'), inHex, el('label',null,'Color'), inColor, el('label',null,'Variant'), selVar);
    const rowA = el('div','row'); const bApplySeed=btn('Apply Seed + Variant','btn primary'); const bOnlyVar=btn('Only Change Variant');
    const stA = el('div','status'); stA.hidden=true; rowA.append(bApplySeed,bOnlyVar); cardA.append(gridA,rowA,stA);
  
    const cardB = el('section','card'); cardB.append(el('h3',null,'Wallpaper'));
    const controlsB = el('div','row');
    const inputFile = input('local-file','file',''); inputFile.accept='image/*';
    const bUseSystem = btn('Set Local Image (System Picker)'); const bUseSelected = btn('Set Selected File (Best-effort)');
    const bClear = btn('Clear Background'); const bDailyOn = btn('Daily Refresh: ON'); const bDailyOff = btn('Daily Refresh: OFF');
    controlsB.append(inputFile,bUseSystem,bUseSelected,bClear,bDailyOn,bDailyOff);
    const stB = el('div','status'); stB.hidden=true;
    const selectedBox = el('div','status','Choose a wallpaper tile below.'); selectedBox.hidden=false;
    const gridWrap = el('div','wall-grid');
    const bApplySelected = btn('Apply Selected Wallpaper','btn primary'); bApplySelected.disabled = true;
    cardB.append(controlsB, stB, selectedBox, gridWrap, bApplySelected);
  
    const cardC = el('section','card half'); cardC.append(el('h3',null,'Device & Defaults'));
    const rowC = el('div','row'); const inFollow=input('follow','checkbox'); const followWrap=el('label',null,' Follow Device Theme'); followWrap.prepend(inFollow);
    const bClassic = btn('Reset to Classic'); const stC = el('div','status'); stC.hidden=true;
    rowC.append(followWrap,bClassic); cardC.append(rowC,stC);
  
    const cardD = el('section','card half'); cardD.append(el('h3',null,'Quick Actions'));
    const rowD = el('div','row'); const bListCollections=btn('List Collections'); const bListImages=btn('List Images (1st Collection)');
    const bDump = btn('Dump Theme (Console)'); const stD = el('div','status'); stD.hidden=true;
    rowD.append(bListCollections,bListImages,bDump); cardD.append(rowD,stD);
  
    const cardE = el('section','card'); cardE.append(el('h3',null,'Toolbar Pins'));
    const rowE = el('div','row'); const searchE=input('toolbar-search','text',''); searchE.placeholder='Filter by name or id…'; searchE.style.minWidth='260px';
    const bRefreshE=btn('Refresh','btn primary'); const bResetE=btn('Reset to Default'); const stE=el('div','status'); stE.hidden=true;
    const listE = el('div','ctp-list'); rowE.append(searchE,bRefreshE,bResetE); cardE.append(rowE,stE,listE);
  
    const footer = el('div','footer','Built by pilot bell');
  
    const appContainer = document.createElement('div');
    appContainer.id = 'app';
    app.append(header);
    main.append(cardA,cardB,cardC,cardD,cardE);
    app.append(main, footer);
    root.appendChild(app);
  
    function collapsify(card) {
      if (!card) return;
      const h3 = card.querySelector('h3');
      if (!h3) return;
  
      const head = document.createElement('button');
      head.className = 'card-head';
      head.type = 'button';
      head.setAttribute('aria-expanded', 'false'); // default collapsed
  
      const chev = document.createElement('i'); chev.className = 'chev';
      const title = document.createElement('span'); title.className = 'title';
      title.textContent = h3.textContent || 'Section';
      const right = document.createElement('span'); right.className = 'subtle';
  
      head.append(chev, title, right);
  
      const body = document.createElement('div');
      body.className = 'card-body';
      while (h3.nextSibling) body.appendChild(h3.nextSibling);
  
      h3.remove();
      card.append(head, body);
  
      head.addEventListener('click', () => {
        const open = head.getAttribute('aria-expanded') === 'true';
        head.setAttribute('aria-expanded', String(!open));
        card.setAttribute('aria-expanded', String(!open));
      });
  
      card.setAttribute('aria-expanded', 'false');
    }
    [cardA, cardB, cardC, cardD, cardE].forEach(collapsify);
  
    const mmDark = matchMedia('(prefers-color-scheme: dark)');
    const applyMode = ()=> app.classList.toggle('light', !mmDark.mat
