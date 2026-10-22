/**
 * Pregunta por WebGL en un worker. Si el contexto no llega en el plazo,
 * el hilo principal no llama a getContext: en algunos Chromium sin GPU
 * esa llamada no vuelve y la página se queda en blanco.
 */
export function probeWebGL(timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let worker: Worker | null = null;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      worker?.terminate();
      resolve(ok);
    };
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    try {
      const source = `
        self.onmessage = () => {
          try {
            if (typeof OffscreenCanvas !== 'function') { self.postMessage(false); return; }
            const canvas = new OffscreenCanvas(8, 8);
            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            const ok = !!(gl && gl.getParameter(gl.VERSION));
            const lose = gl && gl.getExtension('WEBGL_lose_context');
            if (lose) lose.loseContext();
            self.postMessage(ok);
          } catch (error) {
            self.postMessage(false);
          }
        };
      `;
      worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
      worker.onmessage = (event) => finish(event.data === true);
      worker.onerror = () => finish(false);
      worker.postMessage(0);
    } catch {
      finish(false);
    }
  });
}
