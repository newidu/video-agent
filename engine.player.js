'use strict';

/*
 * Offline player shipped inside exported HTML files.
 * The editing engine itself remains in index.html; this player only reads
 * the serialised project spec and renders its text/code scene elements.
 */
(function attachStandaloneEngine(global) {
  const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
  const lerp = (a,b,t) => a + (b-a)*t;
  const inv = (value,a,b) => clamp((value-a)/(b-a),0,1);
  const easeOut = t => 1-Math.pow(1-t,3);

  function createPlayer(canvas, project, options) {
    if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('A canvas element is required.');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available.');
    const callbacks = options || {};
    const payload = project || {};
    const spec = payload.spec || payload;
    const dims = {
      '9:16':[1080,1920],
      '16:9':[1920,1080],
      '1:1':[1080,1080]
    };
    const size = payload.format && payload.format.width
      ? [payload.format.width,payload.format.height]
      : (dims[spec.format] || [1080,1920]);
    const W = Math.max(320,Math.min(3840,Number(size[0])||1080));
    const H = Math.max(320,Math.min(3840,Number(size[1])||1920));
    canvas.width = W;
    canvas.height = H;
    const scenes = Array.isArray(spec.scenes) ? spec.scenes : [];
    const duration = Math.max(0.1,Number(payload.duration) ||
      scenes.reduce((sum,scene)=>sum+Math.max(.1,Number(scene.dur)||3),0) || 15);
    const music = payload.music || spec.music || {};
    const audio = document.createElement('audio');
    audio.preload = 'auto';
    audio.loop = !!music.loop;
    if (music.dataUrl && music.on !== false) audio.src = music.dataUrl;
    audio.volume = clamp(Number(music.volume)||0.8,0,1);

    let current = clamp(Number(payload.playhead)||0,0,duration);
    let playing = false;
    let rate = clamp(Number(payload.playbackSpeed)||1,.25,2);
    let raf = 0;
    let previous = 0;
    let lastReported = -1;

    function sceneAt(time) {
      let offset = 0;
      for (let index=0; index<scenes.length; index++) {
        const scene = scenes[index];
        const length = Math.max(.1,Number(scene.dur)||3);
        if (time < offset + length || index === scenes.length-1) {
          return {scene, index, offset, local:clamp(time-offset,0,length), duration:length};
        }
        offset += length;
      }
      return {scene:null,index:-1,offset:0,local:0,duration:duration};
    }

    function drawText(item, localTime, absoluteTime) {
      const text = String(item.text==null?'':item.text);
      if (!text) return;
      const delay = Number(item.delay)||0;
      const entrance = Math.max(.05,Number(item.dur)||.55);
      const progress = inv(localTime-delay,0,entrance);
      if (item.anim === 'none' && localTime < delay) return;
      if (item.anim !== 'none' && localTime < delay) return;
      const animation = item.anim || 'fade';
      let alpha = 1;
      let scale = 1;
      let dx = 0;
      let dy = 0;
      if (animation === 'fade') alpha = progress;
      else if (animation === 'rise') { alpha=progress; dy=(1-easeOut(progress))*(Number(item.dist)||90); }
      else if (animation === 'slideL') { alpha=progress; dx=-(1-easeOut(progress))*(Number(item.dist)||90)*2.2; }
      else if (animation === 'slideR') { alpha=progress; dx=(1-easeOut(progress))*(Number(item.dist)||90)*2.2; }
      else if (animation === 'pop') { alpha=progress; scale=lerp(.72,1,easeOut(progress)); }
      else if (animation === 'beat') {
        const bpm = clamp(Number(music.bpm)||120,30,300);
        const phase = ((absoluteTime * bpm / 60) % 1 + 1) % 1;
        scale = 1 + .08 * Math.pow(Math.max(0,Math.cos(phase*Math.PI*2)),8);
      }
      if (animation !== 'none' && progress <= 0) return;
      const x = Number(item.x);
      const y = Number(item.y);
      const px = Number.isFinite(x) ? x : W/2;
      const py = Number.isFinite(y) ? y : H/2;
      const size = Math.max(14,Math.min(400,Number(item.size)||64));
      const family = String(item.family || 'Arial');
      const weight = Math.max(100,Math.min(900,Number(item.weight)||600));
      const fontStack = '"Noto Sinhala", "'+family+'", "DejaVu Sans", sans-serif';
      ctx.save();
      ctx.globalAlpha = clamp(alpha,0,1);
      ctx.translate(px+dx,py+dy);
      ctx.scale(scale,scale);
      ctx.font = weight+' '+size+'px '+fontStack;
      ctx.textAlign = ['left','right','center','start','end'].includes(item.align)?item.align:'center';
      ctx.textBaseline = item.baseline || 'middle';
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (item.shadow) {
        ctx.shadowColor = item.shadowColor || 'rgba(0,0,0,.28)';
        ctx.shadowBlur = Math.max(0,Number(item.shadowBlur)||12);
        ctx.shadowOffsetY = Number(item.shadowY)||3;
      }
      const outline = Math.min(Math.max(0,Number(item.outline)||0),size*.05);
      if (outline > 0) {
        ctx.lineWidth = Math.max(1,outline*2);
        ctx.strokeStyle = item.outlineColor || 'rgba(0,0,0,.55)';
        ctx.strokeText(text,0,0, W*.95);
      }
      ctx.fillStyle = item.color || item.fill || '#FFFFFF';
      ctx.fillText(text,0,0,W*.95);
      ctx.restore();
    }

    function drawCode(item, localTime, scene, absoluteTime) {
      const source = String(item.js||'');
      if (!source.trim()) return;
      try {
        const draw = new Function(
          'ctx','W','H','t','scene','el','project','clamp','lerp','inv',
          '"use strict";\n'+source
        );
        ctx.save();
        draw(ctx,W,H,localTime,scene,item,payload,clamp,lerp,inv);
        ctx.restore();
      } catch (error) {
        ctx.save();
        ctx.fillStyle = '#B42318';
        ctx.font = '12px monospace';
        ctx.fillText('Code element error: '+String(error.message||error).slice(0,100),24,H-24);
        ctx.restore();
      }
    }

    function renderFrame(time) {
      current = clamp(Number(time)||0,0,duration);
      ctx.setTransform(1,0,0,1,0,0);
      ctx.globalAlpha = 1;
      ctx.clearRect(0,0,W,H);
      const at = sceneAt(current);
      const scene = at.scene;
      const background = (scene && scene.bg) || spec.background || payload.background || '#111111';
      ctx.fillStyle = background;
      ctx.fillRect(0,0,W,H);
      if (scene && Array.isArray(scene.elements)) {
        for (const item of scene.elements) {
          if (!item || item.hidden) continue;
          if (item.type === 'code' || item.js) drawCode(item,at.local,scene,current);
          else drawText(item,at.local,current);
        }
      }
      if (typeof callbacks.onTime === 'function' && Math.abs(current-lastReported)>.02) {
        lastReported=current;
        callbacks.onTime(current,duration,at.index);
      }
      return current;
    }

    function tick(now) {
      if (!playing) return;
      const delta = previous ? (now-previous)/1000 : 0;
      previous = now;
      if (audio.src && !audio.paused && Number.isFinite(audio.currentTime)) {
        current = clamp(audio.currentTime*rate,0,duration);
      } else {
        current = clamp(current+delta*rate,0,duration);
      }
      renderFrame(current);
      if (current >= duration) {
        pause();
        return;
      }
      raf = requestAnimationFrame(tick);
    }

    function play() {
      if (playing) return;
      if (current >= duration) seek(0);
      playing = true;
      previous = 0;
      if (audio.src) {
        try { audio.currentTime = current / rate; audio.playbackRate = rate; audio.play().catch(()=>{}); } catch (error) {}
      }
      raf = requestAnimationFrame(tick);
    }
    function pause() {
      playing = false;
      previous = 0;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      try { audio.pause(); } catch (error) {}
    }
    function seek(value) {
      current = clamp(Number(value)||0,0,duration);
      if (audio.src) {
        try { audio.currentTime = current / rate; } catch (error) {}
      }
      renderFrame(current);
      return current;
    }
    function setSpeed(value) {
      rate = clamp(Number(value)||1,.25,2);
      audio.playbackRate = rate;
      return rate;
    }
    function setVolume(value) {
      audio.volume = clamp(Number(value),0,1);
      return audio.volume;
    }
    function destroy() {
      pause();
      audio.removeAttribute('src');
      audio.load();
    }

    renderFrame(current);
    return Object.freeze({
      renderFrame,play,pause,seek,setSpeed,setVolume,destroy,
      get time(){return current;},
      get duration(){return duration;},
      get playing(){return playing;},
      canvas:canvas
    });
  }

  global.AIVideoPlayer = Object.freeze({createPlayer});
})(window);
