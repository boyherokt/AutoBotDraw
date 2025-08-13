(async () => {
  const CONFIG = {
    PIXEL_DELAY_MS: 120,
    JITTER_MS: [80, 220],
    LOG_INTERVAL: 10,
    THEME: { primary:'#000000', secondary:'#111111', accent:'#222222', text:'#ffffff', highlight:'#775ce3', success:'#00ff00', error:'#ff0000' }
  };

  const state = {
    running:false, paintedCount:0,
    charges:{ count:0, max:80, cooldownMs:30000 },
    userInfo:null, minimized:false, menuOpen:false, language:'vi',
    region:null, startPosition:null, lastOffset:{x:0,y:0}
  };

  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const jitter = () => { const [a,b]=CONFIG.JITTER_MS; return Math.floor(a + Math.random()*(b-a)); };

  async function getCharges(){
    try{
      const res = await fetch('https://backend.wplace.live/me', {credentials:'include'});
      if(res.status===403) return {ok:false, forbidden:true};
      const data = await res.json();
      state.userInfo = data;
      const c = data.charges || {};
      state.charges = { count:Math.floor(c.count||0), max:Math.floor(c.max||0), cooldownMs:c.cooldownMs||30000 };
      if (state.userInfo.level!=null) state.userInfo.level = Math.floor(state.userInfo.level);
      return {ok:true};
    }catch{ return {ok:false}; }
  }

  async function paintPixelInRegion(regionX, regionY, pixelX, pixelY, colorId){
    const res = await fetch(\`https://backend.wplace.live/s0/pixel/\${regionX}/\${regionY}\`, {
      method:'POST', headers:{'Content-Type':'text/plain;charset=UTF-8'}, credentials:'include',
      body: JSON.stringify({ coords:[pixelX, pixelY], colors:[colorId] })
    });
    if(res.status===403) return {ok:false, forbidden:true};
    try{ const data = await res.json(); return {ok: data?.painted===1}; }catch{ return {ok:false}; }
  }

  async function selectStartPosition(){
    return new Promise((resolve)=>{
      const originalFetch = window.fetch;
      window.fetch = async (url, options) => {
        try{
          if (typeof url==='string' && url.includes('https://backend.wplace.live/s0/pixel/') && options?.method?.toUpperCase()==='POST'){
            const response = await originalFetch(url, options);
            const clone = response.clone();
            try{
              const data = await clone.json();
              if (data?.painted===1){
                const m = url.match(/\/pixel\/(\d+)\/(\d+)/);
                const region = (m && m[1] && m[2]) ? {x:parseInt(m[1]), y:parseInt(m[2])} : null;
                const payload = JSON.parse(options.body);
                const start = (payload?.coords && Array.isArray(payload.coords)) ? {x:payload.coords[0], y:payload.coords[1]} : null;
                if(region && start){ window.fetch = originalFetch; resolve({region,start}); }
              }
            }catch{}
            return response;
          }
          return originalFetch(url, options);
        }catch(e){ return originalFetch(url, options); }
      };
      setTimeout(()=>{ try{window.fetch=originalFetch;}catch{} resolve(null); }, 120000);
    });
  }

  function createUI(){
    if (state.menuOpen) return; state.menuOpen = true;
    const fa = document.createElement('link'); fa.rel='stylesheet'; fa.href='https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'; document.head.appendChild(fa);
    const style = document.createElement('style'); style.textContent = \`
      @keyframes pulse {0%{box-shadow:0 0 0 0 rgba(0,255,0,.7);}70%{box-shadow:0 0 0 10px rgba(0,255,0,0);}100%{box-shadow:0 0 0 0 rgba(0,255,0,0);}}
      @keyframes slideIn {from{transform:translateY(20px);opacity:0;}to{transform:translateY(0);opacity:1;}}
      .wplace-bot-panel{position:fixed;top:20px;right:20px;width:260px;background:\${CONFIG.THEME.primary};border:1px solid \${CONFIG.THEME.accent};border-radius:8px;padding:0;box-shadow:0 5px 15px rgba(0,0,0,.5);z-index:9999;font-family:'Segoe UI',Roboto,sans-serif;color:\${CONFIG.THEME.text};animation:slideIn .4s ease-out;overflow:hidden;}
      .wplace-header{padding:12px 15px;background:\${CONFIG.THEME.secondary};color:\${CONFIG.THEME.highlight};font-size:16px;font-weight:600;display:flex;justify-content:space-between;align-items:center;cursor:move;user-select:none;}
      .wplace-header-title{display:flex;align-items:center;gap:8px;}
      .wplace-header-btn{background:none;border:none;color:\${CONFIG.THEME.text};cursor:pointer;opacity:.7;transition:opacity .2s;}
      .wplace-header-btn:hover{opacity:1;}
      .wplace-content{padding:15px;display:\${state.minimized?'none':'block'};}
      .wplace-controls{display:flex;gap:10px;margin-bottom:15px;}
      .wplace-btn{flex:1;padding:10px;border:none;border-radius:6px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:all .2s;}
      .wplace-btn:hover{transform:translateY(-2px);}
      .wplace-btn-primary{background:\${CONFIG.THEME.accent};color:#fff;}
      .wplace-btn-stop{background:\${CONFIG.THEME.error};color:#fff;}
      .wplace-stats{background:\${CONFIG.THEME.secondary};padding:12px;border-radius:6px;margin-bottom:15px;}
      .wplace-stat-item{display:flex;justify-content:space-between;padding:6px 0;font-size:14px;}
      .wplace-stat-label{display:flex;align-items:center;gap:6px;opacity:.8;}
      .wplace-status{padding:8px;border-radius:4px;text-align:center;font-size:13px;}
      .status-default{background:rgba(255,255,255,.1);} .status-success{background:rgba(0,255,0,.1);color:\${CONFIG.THEME.success};} .status-warning{background:rgba(255,165,0,.1);color:orange;} .status-error{background:rgba(255,0,0,.1);color:\${CONFIG.THEME.error};}
      #paintEffect{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;border-radius:8px;}
    \`; document.head.appendChild(style);

    const t = { title:"WPlace Auto-Farm", start:"Bắt đầu", stop:"Dừng", ready:"Sẵn sàng để bắt đầu", user:"Người dùng", pixels:"Pixels", charges:"Lượt vẽ", level:"Cấp" };

    const panel = document.createElement('div');
    panel.className='wplace-bot-panel';
    panel.innerHTML = \`
      <div id="paintEffect"></div>
      <div class="wplace-header">
        <div class="wplace-header-title"><i class="fas fa-paint-brush"></i><span>\${t.title}</span></div>
        <button id="minimizeBtn" class="wplace-header-btn" title="Thu gọn"><i class="fas fa-\${state.minimized?'expand':'minus'}"></i></button>
      </div>
      <div class="wplace-content">
        <div class="wplace-controls">
          <button id="toggleBtn" class="wplace-btn wplace-btn-primary"><i class="fas fa-play"></i><span>\${t.start}</span></button>
        </div>
        <div class="wplace-stats"><div id="statsArea"><div class="wplace-stat-item"><div class="wplace-stat-label"><i class="fas fa-paint-brush"></i> Đang tải...</div></div></div></div>
        <div id="statusText" class="wplace-status status-default">\${t.ready}</div>
      </div>\`;
    document.body.appendChild(panel);

    const header = panel.querySelector('.wplace-header');
    let pos1=0,pos2=0,pos3=0,pos4=0;
    header.onmousedown = e=>{ if(e.target.closest('.wplace-header-btn')) return; e.preventDefault(); pos3=e.clientX; pos4=e.clientY; document.onmouseup=()=>{document.onmousemove=null;}; document.onmousemove=ev=>{ev.preventDefault(); pos1=pos3-ev.clientX; pos2=pos4-ev.clientY; pos3=ev.clientX; pos4=ev.clientY; panel.style.top=(panel.offsetTop-pos2)+'px'; panel.style.left=(panel.offsetLeft-pos1)+'px';}; };

    const toggleBtn = panel.querySelector('#toggleBtn');
    const minimizeBtn = panel.querySelector('#minimizeBtn');
    const content = panel.querySelector('.wplace-content');

    toggleBtn.addEventListener('click', async ()=>{
      state.running = !state.running;
      if (state.running){
        if (!state.region || !state.startPosition){
          updateUI("👆 Hãy tô 1 pixel thủ công để chọn vị trí bắt đầu", "warning");
          const sel = await selectStartPosition();
          if (!sel){ state.running=false; updateUI("❌ Hết thời gian chọn vị trí", "error"); return; }
          state.region = sel.region; state.startPosition = sel.start; state.lastOffset={x:0,y:0};
          updateUI("✅ Đã chọn vị trí bắt đầu!", "success");
        }
        toggleBtn.innerHTML = '<i class="fas fa-stop"></i> <span>'+t.stop+'</span>';
        toggleBtn.classList.remove('wplace-btn-primary'); toggleBtn.classList.add('wplace-btn-stop');
        updateUI('🚀 Bắt đầu tô!', 'success');
        paintLoop().catch(()=>{});
      } else {
        toggleBtn.innerHTML = '<i class="fas fa-play"></i> <span>'+t.start+'</span>';
        toggleBtn.classList.add('wplace-btn-primary'); toggleBtn.classList.remove('wplace-btn-stop');
        updateUI('⏸️ Tạm dừng tô', 'default');
      }
    });

    minimizeBtn.addEventListener('click', ()=>{
      state.minimized = !state.minimized;
      content.style.display = state.minimized?'none':'block';
      minimizeBtn.innerHTML = '<i class="fas fa-'+(state.minimized?'expand':'minus')+'"></i>';
    });

    window.addEventListener('beforeunload', ()=>{ state.menuOpen=false; });
  }

  window.updateUI = (message, type='default')=>{
    const el = document.querySelector('#statusText');
    if (!el) return;
    el.textContent = message;
    el.className = 'wplace-status status-'+type;
    el.style.animation='none'; void el.offsetWidth; el.style.animation='slideIn .3s ease-out';
  };

  window.updateStats = async ()=>{
    const info = await getCharges();
    const stats = document.querySelector('#statsArea');
    if (!stats) return;
    const t = { user:'Người dùng', pixels:'Pixels', charges:'Lượt vẽ', level:'Cấp' };
    stats.innerHTML = \`
      <div class="wplace-stat-item"><div class="wplace-stat-label"><i class="fas fa-user"></i> \${t.user}</div><div>\${state.userInfo?.name || '-'}</div></div>
      <div class="wplace-stat-item"><div class="wplace-stat-label"><i class="fas fa-paint-brush"></i> \${t.pixels}</div><div>\${state.paintedCount}</div></div>
      <div class="wplace-stat-item"><div class="wplace-stat-label"><i class="fas fa-bolt"></i> \${t.charges}</div><div>\${Math.floor(state.charges.count)}/\${Math.floor(state.charges.max)}</div></div>
      <div class="wplace-stat-item"><div class="wplace-stat-label"><i class="fas fa-star"></i> \${t.level}</div><div>\${state.userInfo?.level ?? '0'}</div></div>\`;
    if (info && info.forbidden){ updateUI("⚠️ Bị chặn (403). Hãy tô 1 pixel thủ công để xác thực/captcha, rồi bấm chạy tiếp.", "warning"); state.running=false; }
  };

  async function paintLoop(){
    const {x:regionX,y:regionY} = state.region;
    const {x:startX,y:startY} = state.startPosition;

    for (let y=state.lastOffset.y; state.running; y++){
      for (let x=(y===state.lastOffset.y?state.lastOffset.x:0); state.running; x++){
        // Lấy charges / cooldown
        if (state.charges.count < 1){
          updateUI(\`⌛ Hết lượt vẽ. Chờ \${Math.ceil(state.charges.cooldownMs/1000)}s...\`, 'warning');
          await sleep(state.charges.cooldownMs + 250);
          await updateStats();
          continue;
        }

        // Chọn màu ngẫu nhiên (tránh id đặc biệt 0/5)
        const colorId = Math.floor(Math.random()*31)+1;

        const pixelX = startX + x;
        const pixelY = startY + y;

        const result = await paintPixelInRegion(regionX, regionY, pixelX, pixelY, colorId);

        if (result.forbidden){
          state.lastOffset = {x, y};
          updateUI("⚠️ 403 bị chặn. Tạm dừng! Hãy tô 1 pixel thủ công để vượt captcha, rồi bấm Bắt đầu để tiếp tục.", "warning");
          state.running=false; return;
        }

        if (result.ok){
          state.paintedCount++;
          state.charges.count = Math.max(0, state.charges.count-1);
          const fx = document.getElementById('paintEffect'); if (fx){ fx.style.animation='pulse .5s'; setTimeout(()=>{fx.style.animation='';}, 500); }
          if (state.paintedCount % CONFIG.LOG_INTERVAL === 0){ updateStats(); updateUI(\`🧱 Đã tô \${state.paintedCount} pixel...\`, 'default'); }
        }

        await sleep(CONFIG.PIXEL_DELAY_MS + jitter());
      }
      state.lastOffset.x = 0;
    }
  }

  createUI();
  await updateStats();
})();