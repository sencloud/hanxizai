/* 流体层：用 WebGL 片元着色器算香烟与烛气的连续场。
   这块相当于《清明上河图》项目里的水面——2D 画形体，shader 画场。
   没有 WebGL 时自动回退到 light.incense() 的 Canvas 版本。 */
(function (root) {
  'use strict';
  const HX = (root.HX = root.HX || {});

  const VERT = `
attribute vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

  const FRAG = `
precision mediump float;
uniform float uTime;
uniform float uFlame;
uniform float uSmoke;
uniform float uStill;
uniform float uScale;
uniform vec2  uView;      // 世界坐标左上角
uniform vec2  uRes;       // 画布像素尺寸
uniform vec2  uBurners[6]; // 烟的来处：世界坐标

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i = 0; i < 4; i++){
    v += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

void main(){
  // 屏幕像素 -> 世界坐标
  float wx = uView.x + gl_FragCoord.x / uScale;
  float wy = uView.y + (uRes.y - gl_FragCoord.y) / uScale;

  float sum = 0.0;
  for(int i = 0; i < 6; i++){
    vec2 b = uBurners[i];
    if(b.x < -9000.0) continue;
    float h = (b.y - wy) / 46.0;         // 0 在炉口，向上增大
    if(h < -0.4 || h > 9.0) continue;
    float sway = sin(h * 1.3 + uTime * 0.42 + float(i) * 2.1) * (0.35 + h * 0.16);
    float drift = (wx - b.x) / 46.0 - sway;
    // 越往上越宽、越淡
    float width = 0.55 + h * 0.42;
    float body = exp(-drift * drift / (width * width)) * exp(-h * 0.42);
    float tex = fbm(vec2(drift * 0.8, h * 1.6 - uTime * 0.34));
    sum += body * smoothstep(0.22, 0.85, tex);
  }

  float a = sum * uSmoke * (1.0 - 0.35 * uStill);
  // 烛气：靠近烛焰的一层暖雾
  a += 0.03 * uFlame * (0.5 + 0.5 * fbm(vec2(wx * 0.01, wy * 0.01 - uTime * 0.2)));
  a = clamp(a, 0.0, 0.85);

  vec3 warm = mix(vec3(0.80, 0.76, 0.68), vec3(1.0, 0.83, 0.55), uFlame);
  // 画布按预乘 alpha 合成：颜色必须先乘 alpha，否则会被反预乘成刺眼的高亮
  float outA = a * 0.85;
  gl_FragColor = vec4(warm * outA, outA);
}
`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('shader', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  // 着色器里固定 6 个来处（温酒注子的水汽、烛芯的烟），不足的用远处的空位补齐
  const BURNERS = HX.plate.BURNERS.slice(0, 6);
  while (BURNERS.length < 6) BURNERS.push([-99999, -99999]);

  class Smoke {
    constructor(canvas) {
      this.canvas = canvas;
      this.active = false;
      this.scale = 0.5;                 // 低分辨率渲染，CSS 放大：烟雾是低频信号
      try {
        const opts = { alpha: true, antialias: false, premultipliedAlpha: true, depth: false };
        this.gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
      } catch (e) {
        this.gl = null;
      }
      if (!this.gl) return;
      const gl = this.gl;
      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return;
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return;
      gl.useProgram(p);
      this.program = p;

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(p, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      this.u = {
        time: gl.getUniformLocation(p, 'uTime'),
        flame: gl.getUniformLocation(p, 'uFlame'),
        smoke: gl.getUniformLocation(p, 'uSmoke'),
        still: gl.getUniformLocation(p, 'uStill'),
        scale: gl.getUniformLocation(p, 'uScale'),
        view: gl.getUniformLocation(p, 'uView'),
        res: gl.getUniformLocation(p, 'uRes'),
        burners: gl.getUniformLocation(p, 'uBurners')
      };
      gl.uniform2fv(this.u.burners, new Float32Array(BURNERS.flat()));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);

      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.active = false; });
      canvas.addEventListener('webglcontextrestored', () => { this.active = true; });
      this.active = true;
    }

    resize(cssW, cssH) {
      if (!this.active) return;
      const w = Math.max(2, Math.round(cssW * this.scale));
      const h = Math.max(2, Math.round(cssH * this.scale));
      if (this.canvas.width === w && this.canvas.height === h) return;
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }

    render(state, view, size) {
      if (!this.active) return false;
      const gl = this.gl;
      this.resize(size.w, size.h);
      gl.useProgram(this.program);
      gl.uniform1f(this.u.time, state.time);
      gl.uniform1f(this.u.flame, state.amb.flame);
      gl.uniform1f(this.u.smoke, state.amb.smoke);
      gl.uniform1f(this.u.still, state.amb.still);
      gl.uniform1f(this.u.scale, state.scale * this.scale);
      gl.uniform2f(this.u.view, view.x0, view.y0);
      gl.uniform2f(this.u.res, this.canvas.width, this.canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    }
  }

  HX.smoke = { Smoke };
})(typeof window !== 'undefined' ? window : globalThis);
