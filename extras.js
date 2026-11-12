/* Extra dashboard features, loaded next to the mirrored page (scripts/mirror.py injects it), so the auto-sync never drops them.
   1. "Сегодня" card: failed posts first, today's posts by time, countdown to the next one.
   2. "Лучшее время": average views by posting hour and weekday, from published posts.
   3. iOS-style bottom tab bar that splits the long page into Обзор / Календарь / Рилсы / Статистика.
   Reads the same state.json as the page; touches the page's markup only by adding nodes and data attributes. */
(function(){
  const main=document.getElementById('viewList'); if(!main) return;
  const $=id=>document.getElementById(id);
  const pad=n=>String(n).padStart(2,'0');
  const dkey=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const hm=t=>{const d=new Date(t);return pad(d.getHours())+':'+pad(d.getMinutes());};
  const fmtN=n=>Math.round(Number(n||0)).toLocaleString('ru-RU');
  const plural=(n,a,b,c)=>{const m10=n%10,m100=n%100;if(m10===1&&m100!==11)return a;if(m10>=2&&m10<=4&&(m100<12||m100>14))return b;return c;};
  const el=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e;};
  const isPlan=x=>x.s!=='published'&&x.s!=='failed';
  const ST={published:'вышел',scheduled:'в плане',preparing:'готовится',publishing:'выходит',failed:'ошибка'};
  const TH=id=>'thumbs/'+encodeURIComponent(id)+'.jpg';
  const DAY=['пн','вт','ср','чт','пт','сб','вс'];
  let posts=[];

  function collect(j){
    const out=[]; const R=j.reels||{};
    Object.keys(R).forEach(id=>{const r=R[id]||{}; (r.items||[]).forEach(x=>out.push(Object.assign({rt:'№'+(r.n||+id.slice(1))+' · '+(r.title||'Рилс')},x)));});
    ((j.meta&&j.meta.unmatched)||[]).forEach(x=>out.push(Object.assign({rt:'Рилс не определён'},x)));
    return out.filter(x=>x.t&&!isNaN(new Date(x.t))).sort((a,b)=>new Date(a.t)-new Date(b.t));
  }
  function openViewer(x){
    const v=$('vid'); if(!v) return; $('vErr').hidden=true;
    v.poster=x.th?TH(x.id):''; v.src='https://api.aiara.pro/uploads/publisher/'+encodeURIComponent(x.id)+'_u.mp4';
    v.onerror=()=>{$('vErr').hidden=false;};
    const t=$('vTitle'); t.textContent=x.rt||'Рилс'; t.appendChild(el('small',null,(ST[x.s]||x.s)+' · '+hm(x.t)));
    const o=$('vOpen'); o.hidden=!x.url; if(x.url) o.href=x.url;
    $('viewer').hidden=false; document.body.style.overflow='hidden';
    const p=v.play(); if(p&&p.catch) p.catch(()=>{});
  }
  function mini(x){
    const b=el('button','xth'); b.type='button'; b.setAttribute('aria-label','Смотреть рилс');
    if(x.th){const im=el('img');im.alt='';im.loading='lazy';im.src=TH(x.id);im.onerror=()=>im.remove();b.appendChild(im);}
    b.addEventListener('click',()=>openViewer(x)); return b;
  }

  /* 1. Today */
  const SHOW=4; let showAll=false;
  const today=el('section','card xtoday'); today.setAttribute('aria-label','Сегодня');
  function left(t){const m=Math.max(0,Math.round((new Date(t)-Date.now())/60e3)),h=Math.floor(m/60);return h?h+' ч '+pad(m%60)+' м':m+' мин';}
  function renderToday(){
    const now=new Date(), k=dkey(now), weekAgo=Date.now()-7*864e5;
    const failed=posts.filter(x=>x.s==='failed'&&new Date(x.t)>=weekAgo);
    const list=posts.filter(x=>dkey(new Date(x.t))===k&&x.s!=='failed');
    const tm=new Date(now); tm.setDate(now.getDate()+1); const tomorrow=posts.filter(x=>dkey(new Date(x.t))===dkey(tm)&&isPlan(x)).length;
    const next=posts.find(x=>isPlan(x)&&new Date(x.t)>=Date.now()-30*60e3);
    const pub=list.filter(x=>x.s==='published').length, plan=list.filter(isPlan).length;
    today.textContent='';
    const h=el('div','xhead');
    const hl=el('div'); hl.append(el('div','xcap','Сегодня'),el('div','xsum',list.length?(pub+' '+plural(pub,'вышел','вышло','вышло')+' · '+plan+' в плане'):'Сегодня постов нет'));
    h.appendChild(hl);
    if(next){const c=el('div','xcd num'); c.append(el('b',null,left(next.t)),el('small',null,'до следующего в '+hm(next.t))); h.appendChild(c);}
    today.appendChild(h);
    if(failed.length){
      const f=el('div','xfail');
      f.appendChild(el('div','xfailt','⚠︎ '+failed.length+' '+plural(failed.length,'пост не вышел','поста не вышли','постов не вышли')+' за неделю'));
      failed.slice(-3).forEach(x=>{const r=el('div','xrow'); r.appendChild(mini(x)); const b=el('div','xrb');
        b.append(el('div','xrt',x.rt),el('div','xrs',new Date(x.t).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})+' в '+hm(x.t)+(x.err?' · '+x.err:'')));
        r.appendChild(b); f.appendChild(r);});
      today.appendChild(f);
    }
    if(list.length){
      const tl=el('div','xline');
      const ni=next?list.findIndex(x=>x.id===next.id):-1; const from=ni<0?Math.max(0,list.length-SHOW):Math.max(0,ni-1);
      const vis=showAll?list:list.slice(from,from+SHOW);
      vis.forEach(x=>{const done=x.s==='published', isNext=next&&x.id===next.id;
        const r=el('div','xrow'+(done?' done':'')+(isNext?' next':'')); r.appendChild(el('span','xtime num',hm(x.t))); r.appendChild(el('span','xdot'));
        r.appendChild(mini(x)); const b=el('div','xrb'); b.append(el('div','xrt',x.rt),el('div','xrs',done?fmtN(x.v)+' просм. · '+fmtN(x.l)+' лайк.':isNext?'следующий, через '+left(x.t):(ST[x.s]||x.s)));
        r.appendChild(b); tl.appendChild(r);});
      today.appendChild(tl);
      if(list.length>SHOW){const m=el('button','xmore',showAll?'Свернуть':'Все '+list.length+' '+plural(list.length,'пост','поста','постов')+' за сегодня'); m.type='button';
        m.addEventListener('click',()=>{showAll=!showAll;renderToday();}); today.appendChild(m);}
    }
    today.appendChild(el('div','xfoot',tomorrow?'Завтра в плане '+tomorrow+' '+plural(tomorrow,'пост','поста','постов'):'На завтра пока ничего не запланировано'));
  }

  /* 2. Best time */
  const best=el('section','card xbest'); best.setAttribute('aria-label','Лучшее время для постов');
  function renderBest(){
    const cut=Date.now()-864e5;
    const pub=posts.filter(x=>x.s==='published'&&new Date(x.t)<=cut);
    best.textContent='';
    const head=el('div','xhead'); const hl=el('div'); hl.append(el('div','xcap','Лучшее время'),el('div','xsum','Средние просмотры по времени выхода'));
    head.appendChild(hl); best.appendChild(head);
    if(pub.length<3){best.appendChild(el('div','xfoot','Пока мало вышедших постов, чтобы сравнивать. Нужно хотя бы 3 поста старше суток.'));return;}
    const byH={}, byD={};
    pub.forEach(x=>{const d=new Date(x.t), hr=d.getHours(), wd=(d.getDay()+6)%7;
      (byH[hr]=byH[hr]||[]).push(x.v||0); (byD[wd]=byD[wd]||[]).push(x.v||0);});
    const avg=a=>a.reduce((s,v)=>s+v,0)/a.length;
    const hours=Object.keys(byH).map(Number).sort((a,b)=>a-b).map(h=>({h,a:avg(byH[h]),n:byH[h].length}));
    const top=hours.slice().sort((a,b)=>b.a-a.a);
    const mx=Math.max(1,...hours.map(x=>x.a));
    const win=top[0];
    const hero=el('div','xbesthero');
    hero.append(el('b',null,pad(win.h)+':00'),el('span',null,'в среднем '+fmtN(win.a)+' просм. · '+win.n+' '+plural(win.n,'пост','поста','постов')));
    best.appendChild(hero);
    const ch=el('div','xbars'); ch.setAttribute('role','img'); ch.setAttribute('aria-label','Средние просмотры по часам выхода');
    hours.forEach(x=>{const c=el('div','xbar'+(x===win?' win':'')+(top.indexOf(x)<3&&x!==win?' top':'')); c.title=pad(x.h)+':00 · '+fmtN(x.a)+' просм. · '+x.n+' '+plural(x.n,'пост','поста','постов');
      const v=el('span','xv num',x.a>=1000?(x.a/1000).toFixed(1).replace('.0','')+'к':fmtN(x.a)); const f=el('i'); f.style.height=Math.max(4,Math.round(x.a/mx*100))+'%';
      c.append(v,f,el('span','xl num',pad(x.h))); ch.appendChild(c);});
    best.appendChild(ch);
    const days=el('div','xdays'); const dmx=Math.max(1,...Object.values(byD).map(avg));
    DAY.forEach((n,i)=>{const a=byD[i]?avg(byD[i]):null; const d=el('div','xday'+(a==null?' off':''));
      const ring=el('i'); ring.style.setProperty('--p',a==null?0:Math.round(a/dmx*100));
      d.append(ring,el('span','xl',n),el('span','xv num',a==null?'—':fmtN(a))); days.appendChild(d);});
    best.appendChild(days);
    const t3=top.slice(0,3).map(x=>pad(x.h)+':00').join(', ');
    best.appendChild(el('div','xfoot','Чаще ставьте посты на '+t3+'. Учтены '+pub.length+' '+plural(pub.length,'пост','поста','постов')+' старше суток; чем больше выйдет, тем точнее.'));
  }

  /* place cards */
  const rings=main.querySelector('.rings'); if(rings) rings.after(today);
  const tiles=main.querySelector('.tiles'); const warn=$('warn'); (warn||tiles).after(best);

  /* 3. Tabs */
  const TABS=[['ov','Обзор','<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'],
    ['cal','Календарь','<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'],
    ['reels','Рилсы','<rect x="5" y="3" width="14" height="18" rx="3.5"/><path d="m10.5 9.2 4 2.8-4 2.8z" fill="currentColor"/>'],
    ['stats','Статистика','<path d="M5 20V12M10 20V6M15 20v-9M20 20V9"/>']];
  const NAMES={'Календарь':'cal','Статистика':'stats','Рилсы':'reels'};
  function tagSections(){let cur='ov',i=0,prev='';[...main.children].forEach(c=>{const h=c.classList.contains('h2')&&c.querySelector('h2'); if(h&&NAMES[h.textContent.trim()]) cur=NAMES[h.textContent.trim()]; c.dataset.t=cur; if(cur!==prev){i=0;prev=cur;} c.style.setProperty('--i',i++);});}
  tagSections();
  const bar=el('nav','xtabs'); bar.setAttribute('aria-label','Разделы');
  let tab='ov'; try{tab=localStorage.getItem('reelsTab')||'ov';}catch(e){}
  if(!TABS.some(t=>t[0]===tab)) tab='ov';
  function setTab(t,scroll){tab=t; main.dataset.tab=t; try{localStorage.setItem('reelsTab',t);}catch(e){}
    bar.querySelectorAll('button').forEach(b=>b.setAttribute('aria-current',b.dataset.tab===t?'page':'false'));
    main.querySelectorAll('[data-t="'+t+'"].rv').forEach(e=>e.classList.add('in'));
    if(scroll) window.scrollTo({top:0});}
  TABS.forEach(([k,n,ic])=>{const b=el('button'); b.type='button'; b.dataset.tab=k;
    b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+ic+'</svg>';
    b.appendChild(el('span',null,n)); b.addEventListener('click',()=>setTab(k,true)); bar.appendChild(b);});
  document.body.appendChild(bar); document.body.classList.add('has-xtabs');
  setTab(tab,false);

  /* 4. Live glass: cards tilt toward the pointer, a glare follows it, the rim light turns, the wallpaper drifts, controls lean in. */
  const RM=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!RM){
    const root=document.documentElement; let raf=0, last=null, cur=null;
    const MAG='.xtabs button,.pill,.seg button,.calh .nav button,.lsx';
    function frame(){raf=0; const e=last; if(!e) return;
      root.style.setProperty('--px',((e.clientX/innerWidth-.5)*-18).toFixed(1)+'px');
      root.style.setProperty('--py',((e.clientY/innerHeight-.5)*-18).toFixed(1)+'px');
      const c=e.target.closest&&e.target.closest('.card');
      if(cur&&cur!==c){cur.classList.remove('lit','tilt');cur.style.removeProperty('--rx');cur.style.removeProperty('--ry');}
      cur=c;
      if(c){const r=c.getBoundingClientRect(), x=(e.clientX-r.left)/r.width, y=(e.clientY-r.top)/r.height;
        c.style.setProperty('--mx',(x*100).toFixed(1)+'%'); c.style.setProperty('--my',(y*100).toFixed(1)+'%');
        c.style.setProperty('--ra',(Math.atan2(y-.5,x-.5)*180/Math.PI+90).toFixed(0)+'deg');
        c.classList.add('lit');
        if(e.pointerType==='mouse'&&(!c.classList.contains('rv')||c.classList.contains('in'))){
          const k=Math.min(1,520/Math.max(r.height,1)); /* tall cards tilt less */
          c.style.setProperty('--rx',((.5-y)*7*k).toFixed(2)+'deg'); c.style.setProperty('--ry',((x-.5)*8).toFixed(2)+'deg'); c.classList.add('tilt');}
      }
      document.querySelectorAll(MAG).forEach(b=>{const r=b.getBoundingClientRect(), cx=r.left+r.width/2, cy=r.top+r.height/2, dx=e.clientX-cx, dy=e.clientY-cy, d=Math.hypot(dx,dy);
        if(e.pointerType==='mouse'&&d<Math.max(r.width,r.height)){b.style.setProperty('--tx',(dx*.18).toFixed(1)+'px');b.style.setProperty('--ty',(dy*.25).toFixed(1)+'px');b.classList.add('mag');}
        else if(b.classList.contains('mag')){b.classList.remove('mag');b.style.removeProperty('--tx');b.style.removeProperty('--ty');}});
    }
    const move=e=>{last=e; if(!raf) raf=requestAnimationFrame(frame);};
    addEventListener('pointermove',move,{passive:true});
    addEventListener('pointerdown',e=>{move(e); const c=e.target.closest&&e.target.closest('.card'); if(c&&e.pointerType!=='mouse'){c.classList.add('press');}},{passive:true});
    const up=()=>{document.querySelectorAll('.card.press').forEach(c=>c.classList.remove('press')); if(last&&last.pointerType!=='mouse'&&cur){cur.classList.remove('lit');}};
    addEventListener('pointerup',up,{passive:true}); addEventListener('pointercancel',up,{passive:true});
    document.addEventListener('pointerleave',()=>{if(cur){cur.classList.remove('lit','tilt');cur=null;} root.style.setProperty('--px','0px'); root.style.setProperty('--py','0px');});
  }

  /* data */
  async function load(){try{const r=await fetch('state.json',{cache:'no-store'}); if(!r.ok) return; posts=collect(await r.json()); renderToday(); renderBest(); tagSections();}catch(e){}}
  load();
  setInterval(()=>{if(document.visibilityState==='visible') renderToday();},30000);
  setInterval(()=>{if(document.visibilityState==='visible') load();},120000);
})();
