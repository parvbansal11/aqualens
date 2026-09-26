import { useEffect, useRef, useState } from "react";
// Samples the actual video texture. The native video remains underneath as fallback.
// No particles, cursor replacement or overlay photograph is used.
const vertex = `attribute vec2 a_position; varying vec2 uv; void main(){uv=a_position*.5+.5;gl_Position=vec4(a_position,0.,1.);}`;
const fragment = `precision mediump float; varying vec2 uv; uniform sampler2D film; uniform vec2 aspect; uniform vec2 pointer; uniform vec2 velocity; uniform float strength; uniform float time; uniform vec2 clickAt; uniform float clickAge;
void main(){vec2 q=uv;vec2 d=(q-pointer)*vec2(aspect.x/aspect.y,1.);float radius=length(d);float falloff=exp(-radius*radius*58.);float ripple=sin(radius*95.-time*4.)*strength*.0035*falloff;vec2 warp=normalize(d+vec2(.0001))*ripple-velocity*.035*falloff*strength;float clickWave=exp(-pow((length((q-clickAt)*vec2(aspect.x/aspect.y,1.))-clickAge*.13)*38.,2.))*exp(-clickAge*2.4);warp+=normalize(q-clickAt+vec2(.0001))*.0018*clickWave;vec2 cover=(q+warp-.5)*aspect+.5;gl_FragColor=texture2D(film,cover);}`;
export function OceanEnvironment() {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const v = video.current,
      c = canvas.current;
    if (!v || !c) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0,
      visible = true,
      shown = false,
      destroyed = false;
    let gl: WebGLRenderingContext | null = null;
    let draw: ((t: number) => void) | null = null;
    const pointer = {
      x: 0.5,
      y: 0.5,
      oldX: 0.5,
      oldY: 0.5,
      vx: 0,
      vy: 0,
      strength: 0,
      last: 0,
      clickX: 0,
      clickY: 0,
      clickTime: -10000,
    };
    const shader = (type: number, source: string) => {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, source);
      gl!.compileShader(s);
      if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
        gl!.deleteShader(s);
        return null;
      }
      return s;
    };
    let program: WebGLProgram | null = null,
      buffer: WebGLBuffer | null = null,
      texture: WebGLTexture | null = null;
    function schedule() {
      cancelAnimationFrame(raf);
      if (visible && !document.hidden && !reduced.matches && !destroyed) {
        void v!.play().catch(() => {});
        if (draw) raf = requestAnimationFrame(draw);
      } else v!.pause();
    }
    function init() {
      if (reduced.matches || destroyed) return;
      if (gl) {
        schedule();
        return;
      }
      gl = c!.getContext("webgl", {
        alpha: false,
        antialias: false,
        powerPreference: "low-power",
      });
      if (!gl) return;
      const vs = shader(gl.VERTEX_SHADER, vertex),
        fs = shader(gl.FRAGMENT_SHADER, fragment);
      if (!vs || !fs) return;
      program = gl.createProgram()!;
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
      gl.useProgram(program);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW,
      );
      const a = gl.getAttribLocation(program, "a_position");
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      const u = Object.fromEntries(
        [
          "aspect",
          "pointer",
          "velocity",
          "strength",
          "time",
          "clickAt",
          "clickAge",
        ].map((k) => [k, gl!.getUniformLocation(program!, k)]),
      );
      let previous = 0;
      draw = (t) => {
        if (destroyed || !visible || document.hidden || reduced.matches) {
          v!.pause();
          return;
        }
        raf = requestAnimationFrame(draw!);
        if (t - previous < 30) return;
        const dt = Math.min((t - previous) / 1000, 0.1);
        previous = t;
        const rect = c!.getBoundingClientRect();
        const scale = Math.min(window.devicePixelRatio, 1.25);
        const width = Math.round(rect.width * scale),
          height = Math.round(rect.height * scale);
        if (c!.width !== width || c!.height !== height) {
          c!.width = width;
          c!.height = height;
          gl!.viewport(0, 0, width, height);
        }
        if (v!.readyState < 2) return;
        const ratio = width / height / (v!.videoWidth / v!.videoHeight);
        gl!.uniform2f(u.aspect, Math.min(1, ratio), Math.min(1, 1 / ratio));
        pointer.strength *= Math.exp(-dt * 4);
        pointer.vx *= Math.exp(-dt * 6);
        pointer.vy *= Math.exp(-dt * 6);
        gl!.uniform2f(u.pointer, pointer.x, pointer.y);
        gl!.uniform2f(u.velocity, pointer.vx, pointer.vy);
        gl!.uniform1f(u.strength, pointer.strength);
        gl!.uniform1f(u.time, t / 1000);
        gl!.uniform2f(u.clickAt, pointer.clickX, pointer.clickY);
        gl!.uniform1f(u.clickAge, (t - pointer.clickTime) / 1000);
        try {
          gl!.texImage2D(
            gl!.TEXTURE_2D,
            0,
            gl!.RGB,
            gl!.RGB,
            gl!.UNSIGNED_BYTE,
            v!,
          );
          gl!.drawArrays(gl!.TRIANGLES, 0, 6);
          if (!shown) {
            shown = true;
            setReady(true);
          }
        } catch {
          cancelAnimationFrame(raf);
          setReady(false);
        }
      };
      schedule();
    }
    function move(e: PointerEvent) {
      if (e.pointerType === "touch") return;
      const r = c!.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width,
        y = 1 - (e.clientY - r.top) / r.height;
      const dt = Math.max(16, e.timeStamp - pointer.last);
      pointer.vx = Math.max(-1, Math.min(1, ((x - pointer.x) * 1000) / dt));
      pointer.vy = Math.max(-1, Math.min(1, ((y - pointer.y) * 1000) / dt));
      pointer.strength = Math.min(
        1.5,
        pointer.strength + Math.hypot(x - pointer.x, y - pointer.y) * 8,
      );
      pointer.x = x;
      pointer.y = y;
      pointer.last = e.timeStamp;
    }
    function click(e: PointerEvent) {
      const r = c!.getBoundingClientRect();
      pointer.clickX = (e.clientX - r.left) / r.width;
      pointer.clickY = 1 - (e.clientY - r.top) / r.height;
      pointer.clickTime = performance.now();
    }
    function motion() {
      setReady(false);
      shown = false;
      if (!reduced.matches) init();
      schedule();
    }
    const parent = c.parentElement!;
    parent.addEventListener("pointermove", move);
    parent.addEventListener("pointerdown", click);
    document.addEventListener("visibilitychange", schedule);
    reduced.addEventListener("change", motion);
    v.addEventListener("loadeddata", init);
    function contextLost() {
      cancelAnimationFrame(raf);
      setReady(false);
    }
    c.addEventListener("webglcontextlost", contextLost);
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        schedule();
      },
      { threshold: 0.01 },
    );
    observer.observe(parent);
    if (v.readyState >= 2) init();
    else if (!reduced.matches) void v.play().catch(() => {});
    return () => {
      destroyed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      v.pause();
      parent.removeEventListener("pointermove", move);
      parent.removeEventListener("pointerdown", click);
      document.removeEventListener("visibilitychange", schedule);
      reduced.removeEventListener("change", motion);
      v.removeEventListener("loadeddata", init);
      c.removeEventListener("webglcontextlost", contextLost);
      if (gl) {
        gl.deleteTexture(texture);
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
      }
    };
  }, []);
  return (
    <div className="ocean-environment" aria-hidden="true">
      <img className="ocean-poster" src="/media/oceaneye-poster.jpg" alt="" />
      <video
        ref={video}
        className="ocean-video"
        muted
        loop
        playsInline
        preload="metadata"
        poster="/media/oceaneye-poster.jpg"
      >
        <source src="/media/oceaneye-hero.webm" type="video/webm" />
        <source src="/media/oceaneye-hero.mp4" type="video/mp4" />
      </video>
      <canvas
        ref={canvas}
        className={`water-canvas ${ready ? "is-ready" : ""}`}
      />
      <div className="ocean-shade" />
    </div>
  );
}
