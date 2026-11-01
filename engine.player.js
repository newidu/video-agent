'use strict';

/* Small, dependency-free player runtime embedded in exported HTML projects. */
(function attachStandaloneEngine(global) {
  function createPlayer(canvas, project) {
    if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('A canvas element is required.');
    const ctx = canvas.getContext('2d');
    const spec = project || {};
    const size = spec.format || { width: 1920, height: 1080 };
    canvas.width = size.width;
    canvas.height = size.height;
    const items = Array.isArray(spec.items) ? spec.items : [];

    function renderFrame(time) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = spec.background || '#111111';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const item of items) {
        const start = Number(item.delay) || 0;
        const duration = Math.max(.01, Number(item.duration) || Number(spec.duration) || 15);
        if (time < start || time > start + duration) continue;
        const progress = Math.max(0, Math.min(1, (time - start) / duration));
        const fade = item.anim === 'fade' ? Math.min(1, progress * 5, (1 - progress) * 5 + .1) : 1;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, fade));
        if (item.type === 'shape') {
          ctx.fillStyle = item.color || '#FFFFFF';
          ctx.fillRect(Number(item.x) || 0, Number(item.y) || 0, Number(item.w) || 320, Number(item.h) || 180);
        } else {
          ctx.fillStyle = item.color || '#FFFFFF';
          ctx.font = '600 ' + (Number(item.size) || 64) + 'px Arial, sans-serif';
          ctx.textAlign = item.align || 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(item.text || ''), Number(item.x) || canvas.width / 2, Number(item.y) || canvas.height / 2, canvas.width * .9);
        }
        ctx.restore();
      }
    }
    return { renderFrame, duration: Number(spec.duration) || 15, canvas };
  }

  global.AIVideoPlayer = Object.freeze({ createPlayer });
})(window);
