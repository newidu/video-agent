'use strict';

/*
 * Standalone offline renderer for exported AI Video Agent HTML files.
 * Its code-element contract mirrors the editor: (ctx, e, H, t, dur, w, h).
 */
(function attachStandaloneEngine(global) {
  const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
  const lerp = (a,b,t) => a + (b-a)*t;
  const inv = (value,a,b) => clamp((value-a)/(b-a),0,1);
  const easeOut = t => 1-Math.pow(1-t,3);
  const easeIn = t => t*t*t;
  const easeInOut = t => t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
  const easeOutExpo = t => t>=1?1:1-Math.pow(2,-10*t);
  const easeOutBack = (t,s=1.9) => {const c=s+1;return 1+c*Math.pow(t-1,3)+s*Math.pow(t-1,2);};
  const spring = (t,f=3.4,d=7) => t<=0?0:1-Math.exp(-d*t)*Math.cos(2*Math.PI*f*t);
  const springSine = (t,f=3.4,d=7) => t<=0?0:1-Math.exp(-d*t)*Math.sin(2*Math.PI*f*t);
  const hexRGB = value => {
    const c=String(value||'#000000');
    if(/^#[0-9a-f]{6}$/i.test(c))return [parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)];
    return [0,0,0];
  };
  const mix = (a,b,t) => {
    const x=hexRGB(a),y=hexRGB(b);
    return 'rgb('+x.map((v,i)=>Math.round(lerp(v,y[i],clamp(t,0,1)))).join(',')+')';
  };

  function createPlayer(canvas, project, options) {
    if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('A canvas element is required.');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available.');
    const callbacks = options || {};
    const payload = project || {};
    const spec = payload.spec || payload;
    const dims = {'9:16':[1080,1920],'16:9':[1920,1080],'1:1':[1080,1080]};
    const size = payload.format && payload.format.width
      ? [payload.format.width,payload.format.height]
      : (dims[spec.format] || [1080,1920]);
    const W = Math.max(320,Math.min(3840,Number(size[0])||1080));
    const Hh = Math.max(320,Math.min(3840,Number(size[1])||1920));
    canvas.width = W;
    canvas.height = Hh;
    const scenes = Array.isArray(spec.scenes) ? spec.scenes : [];
    const duration = Math.max(.1,Number(payload.duration) ||
      scenes.reduce((sum,scene)=>sum+Math.max(.1,Number(scene.dur)||3),0) || 15);
    const music = payload.music || spec.music || {};
    const voiceover = spec.voiceover || {};
    const musicAudio = document.createElement('audio');
    const voiceAudio = document.createElement('audio');
    musicAudio.preload = 'auto';
    voiceAudio.preload = 'auto';
    musicAudio.loop = !!music.loop;
    if(music.dataUrl && music.on !== false)musicAudio.src=music.dataUrl;
    if(voiceover.dataUrl)voiceAudio.src=voiceover.dataUrl;
    musicAudio.volume=clamp(Number(music.volume)||.8,0,1);
    voiceAudio.volume=clamp(Number(voiceover.volume)||1,0,1);

    let current=clamp(Number(payload.playhead)||0,0,duration);
    let playing=false,rate=clamp(Number(payload.playbackSpeed)||1,.25,2);
    let raf=0,previous=0,lastReported=-1;
    const codeCache=new Map(),lottieCache=new Map(),threeCache=new Map();
    const brandKit=payload.brandKit||spec.brandKit||{};
    let brandImage=null;
    if(brandKit.logoDataUrl && brandKit.useLogo!==false){
      brandImage=new Image();
      brandImage.src=brandKit.logoDataUrl;
    }

    function sceneAt(value){
      let offset=0;
      for(let index=0;index<scenes.length;index++){
        const scene=scenes[index],length=Math.max(.1,Number(scene.dur)||3);
        if(value<offset+length||index===scenes.length-1){
          return {scene,index,offset,local:clamp(value-offset,0,length),duration:length};
        }
        offset+=length;
      }
      return {scene:null,index:-1,offset:0,local:0,duration};
    }

    function fontStack(family){
      return '"Noto Sinhala","'+String(family||'sans-serif').replace(/[";]/g,'')+'","DejaVu Sans",sans-serif';
    }
    function setFont(size,weight=800,family='sans-serif',ls=0){
      ctx.font=weight+' '+size+'px '+fontStack(family);
      try{ctx.letterSpacing=(Number(ls)||0)+'px';}catch(error){}
    }
    function circlePath(x,y,r){
      ctx.beginPath();ctx.arc(x,y,Math.max(.1,r),0,Math.PI*2);ctx.closePath();
    }
    function roundedPath(x,y,w,h,r){
      r=Math.min(Number(r)||0,Math.abs(w)/2,Math.abs(h)/2);
      ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);
      ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
    }
    function starPath(x,y,R,r,n=5,rot=-Math.PI/2){
      ctx.beginPath();
      for(let i=0;i<n*2;i++){
        const angle=rot+i/(n*2)*Math.PI*2,rad=i%2?r:R;
        const px=x+Math.cos(angle)*rad,py=y+Math.sin(angle)*rad;
        i?ctx.lineTo(px,py):ctx.moveTo(px,py);
      }
      ctx.closePath();
    }
    function star4Path(x,y,R,r){
      ctx.beginPath();
      for(let i=0;i<8;i++){
        const angle=-Math.PI/2+i/8*Math.PI*2,rad=i%2?r:R;
        const px=x+Math.cos(angle)*rad,py=y+Math.sin(angle)*rad;
        i?ctx.lineTo(px,py):ctx.moveTo(px,py);
      }
      ctx.closePath();
    }
    function polyPath(points){
      ctx.beginPath();
      (points||[]).forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
      ctx.closePath();
    }
    function inkPath(build,fill,lw=12){
      ctx.beginPath();build();ctx.lineJoin='round';ctx.lineCap='round';
      ctx.strokeStyle='#111111';ctx.lineWidth=lw*2;ctx.stroke();
      if(fill&&fill!=='none'){ctx.fillStyle=fill;ctx.fill();}
    }
    function inkText(value,x,y,opts={}){
      const size=opts.size||120,weight=opts.weight||800,family=opts.family||'sans-serif';
      setFont(size,weight,family,opts.ls||0);
      ctx.textAlign=opts.align||'center';ctx.textBaseline=opts.baseline||'middle';
      ctx.lineJoin='round';ctx.lineCap='round';
      const outline=Math.min(opts.outline===undefined?10:opts.outline,Math.max(0,size*.1));
      if(outline>0){ctx.strokeStyle=opts.strokeColor||'#111111';ctx.lineWidth=outline*2;ctx.strokeText(String(value),x,y);}
      if(opts.color&&opts.color!=='none'){ctx.fillStyle=opts.color;ctx.fillText(String(value),x,y);}
    }
    function drawLottie(id,x,y,w,h,at,elementDuration){
      const animationData=spec.motionAssets&&spec.motionAssets[String(id)];
      const lottie=global.lottie;
      if(!animationData||!lottie||!ctx)return false;
      let entry=lottieCache.get(String(id));
      if(!entry){
        const container=document.createElement('div');
        container.style.cssText='position:fixed;left:-12000px;top:-12000px;width:512px;height:512px;overflow:hidden;pointer-events:none;opacity:0';
        document.body.appendChild(container);
        const animation=lottie.loadAnimation({
          container,renderer:'canvas',loop:false,autoplay:false,
          animationData:JSON.parse(JSON.stringify(animationData)),
          rendererSettings:{clearCanvas:true,progressiveLoad:false,preserveAspectRatio:'xMidYMid meet'}
        });
        entry={container,animation,ready:false};
        lottieCache.set(String(id),entry);
        animation.addEventListener('DOMLoaded',()=>{
          entry.ready=true;
          renderFrame(current);
        });
      }
      if(!entry.ready)return false;
      const frames=Number(entry.animation.totalFrames)||Number(animationData.op)||1;
      const fps=Number(animationData.fr)||30;
      const span=Math.max(.05,Number(elementDuration)||frames/fps);
      const frame=clamp(Math.floor((Math.max(0,Number(at)||0)/span)*frames),0,frames-1);
      entry.animation.goToAndStop(frame,true);
      const image=entry.container.querySelector('canvas');
      if(!image||!image.width||!image.height)return false;
      ctx.drawImage(image,x,y,w,h);
      return true;
    }
    function drawThree(kind,x,y,w,h,at,color){
      const THREE=global.THREE;
      if(!THREE||!(w>0&&h>0))return false;
      const key=(kind+':'+(activeElementId||'default'));
      let entry=threeCache.get(key);
      try{
        if(!entry){
          const buffer=document.createElement('canvas');
          const renderer=new THREE.WebGLRenderer({canvas:buffer,alpha:true,antialias:true,preserveDrawingBuffer:true});
          renderer.setPixelRatio(1);
          const scene=new THREE.Scene();
          const camera=new THREE.PerspectiveCamera(kind==='cube'?36:38,1,.1,100);
          camera.position.z=kind==='cube'?6:5.5;
          scene.add(new THREE.AmbientLight(0xffffff,1.25));
          const light=new THREE.DirectionalLight(0xffffff,2.2);light.position.set(-3,4,6);scene.add(light);
          let mesh;
          if(kind==='cube'){
            mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),new THREE.MeshStandardMaterial({color:color||'#C65A2E',metalness:.28,roughness:.32}));
          }else{
            mesh=new THREE.Mesh(new THREE.IcosahedronGeometry(1.45,2),new THREE.MeshStandardMaterial({color:color||'#C65A2E',metalness:.4,roughness:.3,flatShading:true}));
          }
          scene.add(mesh);
          entry={buffer,renderer,scene,camera,mesh};
          threeCache.set(key,entry);
        }
        const width=Math.max(64,Math.min(1200,Math.round(w))),height=Math.max(64,Math.min(1200,Math.round(h)));
        if(entry.buffer.width!==width||entry.buffer.height!==height){
          entry.renderer.setSize(width,height,false);
          entry.camera.aspect=width/height;entry.camera.updateProjectionMatrix();
        }
        entry.mesh.rotation.x=(Number(at)||0)*(kind==='cube'?.62:.48)+(kind==='cube'?.28:0);
        entry.mesh.rotation.y=(Number(at)||0)*(kind==='cube'?.84:.74)+(kind==='cube'?.42:0);
        if(color&&entry.mesh.material)entry.mesh.material.color.set(color);
        entry.renderer.render(entry.scene,entry.camera);
        ctx.drawImage(entry.buffer,x,y,w,h);
        return true;
      }catch(error){console.warn('Standalone Three.js renderer:',error);return false;}
    }

    let activeElementId=null;
    const ART={
      W,H:Hh,t:0,dur:1,id:null,e:null,P:{bg:'#111111',paper:'#FFFFFF'},
      PAL:['#171614','#C65A2E','#F7F6F3','#FFFFFF'],INK:'#171614',
      clamp,lerp,mix,eOut:easeOut,eIn:easeIn,eInOut:easeInOut,eOutExpo:easeOutExpo,eOutBack:easeOutBack,
      sp:spring,spS:springSine,beatEnv:(t,decay=4)=>Math.pow(1-(((t*(Number(music.bpm)||120)/60)%1+1)%1),decay),inv,
      circle:circlePath,rr:roundedPath,star:starPath,star4:star4Path,poly:polyPath,ink:inkPath,
      setFont,text:inkText,measure:(value,size,weight=800,family='sans-serif',ls=0)=>{setFont(size,weight,family,ls);return ctx.measureText(String(value)).width;},
      fill(fn,color){fn();ctx.fillStyle=color;ctx.fill();},
      stroke(fn,color,lw){fn();ctx.strokeStyle=color||'#171614';ctx.lineWidth=lw||10;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();},
      reg(){},
      rnd(i){const x=Math.sin(i*127.1+311.7)*43758.5453;return x-Math.floor(x);},
      lottie:drawLottie,
      cube3D:(x,y,w,h,t,color)=>drawThree('cube',x,y,w,h,t,color),
      sphere3D:(x,y,w,h,t,color)=>drawThree('sphere',x,y,w,h,t,color)
    };

    function sceneAt(value){
      let offset=0;
      for(let index=0;index<scenes.length;index++){
        const scene=scenes[index],length=Math.max(.1,Number(scene.dur)||3);
        if(value<offset+length||index===scenes.length-1)return {scene,index,offset,local:clamp(value-offset,0,length),duration:length};
        offset+=length;
      }
      return {scene:null,index:-1,offset:0,local:0,duration};
    }

    function drawText(item,localTime,absoluteTime){
      const text=String(item.text==null?'':item.text);
      if(!text)return;
      if(item.start!==undefined&&localTime<Number(item.start))return;
      if(item.end!==undefined&&localTime>=Number(item.end))return;
      const delay=Number(item.delay)||0;
      const entrance=Math.max(.05,Number(item.dur)||.55);
      const progress=inv(localTime-delay,0,entrance);
      if(localTime<delay)return;
      const animation=item.anim||'fade';
      let alpha=1,scale=1,dx=0,dy=0;
      if(animation==='fade')alpha=progress;
      else if(animation==='rise'){alpha=progress;dy=(1-easeOut(progress))*(Number(item.dist)||90);}
      else if(animation==='slideL'){alpha=progress;dx=-(1-easeOut(progress))*(Number(item.dist)||90)*2.2;}
      else if(animation==='slideR'){alpha=progress;dx=(1-easeOut(progress))*(Number(item.dist)||90)*2.2;}
      else if(animation==='pop'){alpha=progress;scale=lerp(.72,1,easeOut(progress));}
      else if(animation==='beat'){
        const bpm=clamp(Number(music.bpm)||120,30,300);
        const phase=((absoluteTime*bpm/60)%1+1)%1;
        scale=1+.08*Math.pow(Math.max(0,Math.cos(phase*Math.PI*2)),8);
      }
      if(animation!=='none'&&progress<=0)return;
      const px=Number.isFinite(Number(item.x))?Number(item.x):W/2;
      const py=Number.isFinite(Number(item.y))?Number(item.y):Hh/2;
      const size=Math.max(14,Math.min(400,Number(item.size)||64));
      const family=String(item.family||'Arial');
      const weight=Math.max(100,Math.min(900,Number(item.weight)||600));
      ctx.save();ctx.globalAlpha=clamp(alpha,0,1);ctx.translate(px+dx,py+dy);ctx.scale(scale,scale);
      setFont(size,weight,family,item.ls||0);
      ctx.textAlign=['left','right','center','start','end'].includes(item.align)?item.align:'center';
      ctx.textBaseline=item.baseline||'middle';ctx.lineJoin='round';ctx.lineCap='round';
      if(item.shadow){ctx.shadowColor=item.shadowColor||'rgba(0,0,0,.28)';ctx.shadowBlur=Math.max(0,Number(item.shadowBlur)||12);ctx.shadowOffsetY=Number(item.shadowY)||3;}
      const outline=Math.min(Math.max(0,Number(item.outline)||0),size*.05);
      if(outline>0){ctx.lineWidth=Math.max(1,outline*2);ctx.strokeStyle=item.outlineColor||'rgba(0,0,0,.55)';ctx.strokeText(text,0,0,W*.95);}
      ctx.fillStyle=item.color||item.fill||'#FFFFFF';ctx.fillText(text,0,0,W*.95);ctx.restore();
    }

    const codeCache=new Map();
    function drawCode(item,localTime,sceneDuration,scene,absoluteTime){
      const source=String(item.js||'');
      if(!source.trim())return;
      if(item.start!==undefined&&localTime<Number(item.start))return;
      if(item.end!==undefined&&localTime>=Number(item.end))return;
      let draw=codeCache.get(source);
      if(!draw){
        try{
          draw=new Function('ctx','e','H','t','dur','w','h','"use strict";\n'+source);
          codeCache.set(source,draw);
        }catch(error){throw error;}
      }
      const delay=Number(item.delay)||0;
      const entrance=Math.max(.05,Number(item.dur)||.55);
      const progress=inv(localTime-delay,0,entrance);
      const animation=item.anim||'none';
      const anchorX=Number.isFinite(Number(item.x))?Number(item.x):W/2;
      const anchorY=Number.isFinite(Number(item.y))?Number(item.y):Hh/2;
      const distance=Number(item.dist===undefined?90:item.dist)||90;
      ctx.save();
      if(animation==='fade')ctx.globalAlpha=clamp(progress,0,1);
      ctx.translate(anchorX,anchorY);
      if(animation==='rise')ctx.translate(0,(1-easeOut(progress))*distance);
      if(animation==='slideL')ctx.translate(-(1-easeOut(progress))*distance*2.2,0);
      if(animation==='slideR')ctx.translate((1-easeOut(progress))*distance*2.2,0);
      if(animation==='pop'){const scale=lerp(.72,1,easeOut(progress));ctx.scale(scale,scale);}
      ART.W=W;ART.H=Hh;ART.t=localTime;ART.dur=sceneDuration;ART.id=item.id||'standalone-code';ART.e=item;
      activeElementId=ART.id;
      try{draw(ctx,item,ART,localTime,sceneDuration,Number(item.w)||400,Number(item.h)||400);}
      finally{activeElementId=null;ctx.restore();}
    }

    function drawBrandLogo(){
      if(!brandImage||!brandImage.complete||!brandImage.naturalWidth||brandKit.useLogo===false)return;
      const ratio=brandImage.naturalWidth/brandImage.naturalHeight;
      const width=Math.min(W*.18,Math.max(W*.08,Math.min(280,W*.14)));
      const height=width/Math.max(.1,ratio);
      const margin=W*.055;
      const x=String(brandKit.logoPosition||'bottom-right').includes('left')?margin:W-width-margin;
      const y=String(brandKit.logoPosition||'bottom-right').includes('top')?margin:Hh-height-margin;
      ctx.save();ctx.globalAlpha=.92;ctx.drawImage(brandImage,x,y,width,height);ctx.restore();
    }

    function renderFrame(time){
      current=clamp(Number(time)||0,0,duration);
      ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.clearRect(0,0,W,Hh);
      const at=sceneAt(current),scene=at.scene;
      ctx.fillStyle=(scene&&scene.bg)||spec.background||payload.background||'#111111';
      ctx.fillRect(0,0,W,Hh);
      if(scene&&Array.isArray(scene.elements)){
        scene.elements.forEach(item=>{
          if(!item||item.hidden)return;
          try{
            if(item.type==='code'||item.js!==undefined)drawCode(item,at.local,at.duration,scene,current);
            else drawText(item,at.local,current);
          }catch(error){
            ctx.save();ctx.fillStyle='#B42318';ctx.font='12px monospace';
            ctx.fillText('Code element error: '+String(error.message||error).slice(0,100),24,Hh-24);ctx.restore();
          }
        });
      }
      drawBrandLogo();
      if(typeof callbacks.onTime==='function'&&Math.abs(current-lastReported)>.02){
        lastReported=current;callbacks.onTime(current,duration,at.index);
      }
      return current;
    }

    function syncVoice(){
      if(!voiceAudio.src)return;
      try{
        voiceAudio.currentTime=Math.min(current/rate,Math.max(0,(voiceAudio.duration||current/rate)-.03));
        voiceAudio.playbackRate=rate;
      }catch(error){}
    }
    function tick(now){
      if(!playing)return;
      const delta=previous?(now-previous)/1000:0;previous=now;
      if(musicAudio.src&&!musicAudio.paused&&Number.isFinite(musicAudio.currentTime))current=clamp(musicAudio.currentTime*rate,0,duration);
      else current=clamp(current+delta*rate,0,duration);
      if(voiceAudio.src&&Math.abs(voiceAudio.currentTime-current/rate)>.28)syncVoice();
      renderFrame(current);
      if(current>=duration){pause();return;}
      raf=requestAnimationFrame(tick);
    }
    function play(){
      if(playing)return;
      if(current>=duration)seek(0);
      playing=true;previous=0;
      if(musicAudio.src){try{musicAudio.currentTime=current/rate;musicAudio.playbackRate=rate;musicAudio.play().catch(()=>{});}catch(error){}}
      if(voiceAudio.src){syncVoice();voiceAudio.play().catch(()=>{});}
      raf=requestAnimationFrame(tick);
    }
    function pause(){
      playing=false;previous=0;if(raf)cancelAnimationFrame(raf);raf=0;
      try{musicAudio.pause();voiceAudio.pause();}catch(error){}
    }
    function seek(value){
      current=clamp(Number(value)||0,0,duration);
      try{if(musicAudio.src)musicAudio.currentTime=current/rate;if(voiceAudio.src)syncVoice();}catch(error){}
      renderFrame(current);return current;
    }
    function setSpeed(value){
      rate=clamp(Number(value)||1,.25,2);
      musicAudio.playbackRate=rate;voiceAudio.playbackRate=rate;return rate;
    }
    function setVolume(value){
      musicAudio.volume=clamp(Number(value),0,1);
      voiceAudio.volume=clamp(Number(value)*Number(voiceover.volume??1),0,1);
      return musicAudio.volume;
    }
    function destroy(){
      pause();
      musicAudio.removeAttribute('src');voiceAudio.removeAttribute('src');
      musicAudio.load();voiceAudio.load();
      for(const entry of lottieCache.values()){
        try{entry.animation.destroy();entry.container.remove();}catch(error){}
      }
      for(const entry of threeCache.values()){
        try{entry.renderer.dispose();}catch(error){}
      }
      lottieCache.clear();threeCache.clear();
    }

    renderFrame(current);
    return Object.freeze({
      renderFrame,play,pause,seek,setSpeed,setVolume,destroy,
      get time(){return current;},get duration(){return duration;},get playing(){return playing;},canvas
    });
  }

  global.AIVideoPlayer=Object.freeze({createPlayer});
})(window);
