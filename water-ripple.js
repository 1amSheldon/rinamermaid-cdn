/**
 * water-ripple.js
 * Mermaid / Академия русалок
 * Created by RxGroup on 15.07.2026.
 * Copyright © 2026 RX Group. All rights reserved.
 */

(function exposeRinaWaterEffect(global) {
  "use strict";

  if (global.RinaWaterEffect?.mount) {
    global.dispatchEvent(new CustomEvent("rina-water-effect-ready"));
    return;
  }

  const TRAIL_COUNT = 20;
  const TRAIL_LIFETIME = 760;
  const mounts = new WeakMap();

  const VERTEX_SHADER = `
    attribute vec2 a_position;
    varying vec2 v_uv;

    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const FRAGMENT_SHADER = `
    precision mediump float;

    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform vec2 u_canvasSize;
    uniform vec2 u_textureSize;
    uniform vec2 u_objectPosition;
    uniform vec3 u_pointer;
    uniform vec4 u_trail[${TRAIL_COUNT}];

    vec2 toScreenSpace(vec2 delta, float aspect) {
      return vec2(delta.x * aspect, delta.y);
    }

    vec2 fromScreenSpace(vec2 delta, float aspect) {
      return vec2(delta.x / aspect, delta.y);
    }

    vec2 coverUv(vec2 screenUv) {
      float canvasAspect = u_canvasSize.x / max(u_canvasSize.y, 1.0);
      float textureAspect = u_textureSize.x / max(u_textureSize.y, 1.0);
      vec2 scale = vec2(1.0);

      if (canvasAspect > textureAspect) {
        scale.y = textureAspect / canvasAspect;
      } else {
        scale.x = canvasAspect / textureAspect;
      }

      // CSS object-position uses a top-left origin; WebGL texture UV uses bottom-left.
      vec2 alignment = vec2(u_objectPosition.x, 1.0 - u_objectPosition.y);
      return screenUv * scale + (vec2(1.0) - scale) * alignment;
    }

    void main() {
      float aspect = u_canvasSize.x / max(u_canvasSize.y, 1.0);
      vec2 displacement = vec2(0.0);

      // Connected, oscillating capsules create a narrow water wake along the
      // pointer path. There is deliberately no magnifying lens at the cursor.
      for (int index = 0; index < ${TRAIL_COUNT}; index += 1) {
        vec4 trail = u_trail[index];
        vec2 point = toScreenSpace(v_uv, aspect);
        vec2 start = toScreenSpace(trail.xy, aspect);
        vec2 end = index == 0
          ? toScreenSpace(u_pointer.xy, aspect)
          : toScreenSpace(u_trail[index - 1].xy, aspect);
        vec2 segment = end - start;
        float segmentLengthSquared = max(dot(segment, segment), 0.000001);
        float segmentProgress = clamp(dot(point - start, segment) / segmentLengthSquared, 0.0, 1.0);
        vec2 delta = point - (start + segment * segmentProgress);
        float distance = length(delta);
        float radius = mix(0.012, 0.030, trail.w);
        float envelope = exp(-(distance * distance) / max(radius * radius, 0.0001));
        float wave = sin(distance * 230.0 - trail.w * 12.0);
        vec2 normal = distance > 0.0001 ? delta / distance : vec2(0.0);
        displacement += normal * wave * envelope * trail.z * 0.010;
      }

      // Keep the refraction calm even when the pointer moves very quickly.
      float displacementLength = length(displacement);
      displacement *= min(1.0, 0.012 / max(displacementLength, 0.0001));

      vec2 distortedScreenUv = clamp(
        v_uv + fromScreenSpace(displacement, aspect),
        vec2(0.001),
        vec2(0.999)
      );
      gl_FragColor = texture2D(u_texture, coverUv(distortedScreenUv));
    }
  `;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function addMediaListener(query, listener) {
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    }

    query.addListener(listener);
    return () => query.removeListener(listener);
  }

  function parsePositionToken(token, axis) {
    const normalized = String(token || "").trim().toLowerCase();
    const keywordValues = axis === "x"
      ? { left: 0, center: 0.5, right: 1 }
      : { top: 0, center: 0.5, bottom: 1 };

    if (Object.prototype.hasOwnProperty.call(keywordValues, normalized)) {
      return keywordValues[normalized];
    }

    if (normalized.endsWith("%")) {
      const percentage = Number.parseFloat(normalized);
      return Number.isFinite(percentage) ? clamp(percentage / 100, 0, 1) : 0.5;
    }

    return 0.5;
  }

  function readObjectPosition(video) {
    const value = global.getComputedStyle(video).objectPosition || "50% 50%";
    const tokens = value.trim().split(/\s+/);

    if (tokens.length === 1) {
      const token = tokens[0].toLowerCase();
      if (token === "top" || token === "bottom") {
        return [0.5, parsePositionToken(token, "y")];
      }
      return [parsePositionToken(token, "x"), 0.5];
    }

    return [
      parsePositionToken(tokens[0], "x"),
      parsePositionToken(tokens[1], "y"),
    ];
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) {
      throw new Error("Не удалось создать WebGL-шейдер.");
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Неизвестная ошибка компиляции.";
      gl.deleteShader(shader);
      throw new Error(message);
    }

    return shader;
  }

  function createProgram(gl) {
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();

    if (!program) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      throw new Error("Не удалось создать WebGL-программу.");
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "Неизвестная ошибка линковки.";
      gl.deleteProgram(program);
      throw new Error(message);
    }

    return program;
  }

  function getUniformLocations(gl, program) {
    return {
      texture: gl.getUniformLocation(program, "u_texture"),
      canvasSize: gl.getUniformLocation(program, "u_canvasSize"),
      textureSize: gl.getUniformLocation(program, "u_textureSize"),
      objectPosition: gl.getUniformLocation(program, "u_objectPosition"),
      pointer: gl.getUniformLocation(program, "u_pointer"),
      trail: gl.getUniformLocation(program, "u_trail[0]"),
    };
  }

  function mount(options) {
    const container = options && options.container;
    const video = options && options.video;
    const canvas = options && options.canvas;

    if (!container || typeof container.addEventListener !== "function") {
      throw new TypeError("RinaWaterEffect: container должен быть DOM-элементом.");
    }
    if (!video || String(video.tagName).toLowerCase() !== "video") {
      throw new TypeError("RinaWaterEffect: video должен быть HTMLVideoElement.");
    }
    if (!canvas || String(canvas.tagName).toLowerCase() !== "canvas") {
      throw new TypeError("RinaWaterEffect: canvas должен быть HTMLCanvasElement.");
    }

    const previousMount = mounts.get(canvas);
    if (previousMount) {
      previousMount.destroy();
    }

    const finePointer = global.matchMedia("(pointer: fine)");
    const originalCanvasState = {
      visibility: canvas.style.visibility,
      pointerEvents: canvas.style.pointerEvents,
      ariaHidden: canvas.getAttribute("aria-hidden"),
      readyClass: canvas.classList.contains("is-ready"),
      width: canvas.width,
      height: canvas.height,
    };

    let destroyed = false;
    let failed = false;
    let initialized = false;
    let active = true;
    let isIntersecting = false;
    let rafId = 0;
    let lastFrameTime = 0;
    let gl = null;
    let program = null;
    let positionBuffer = null;
    let texture = null;
    let uniforms = null;
    let uploadedWidth = 0;
    let uploadedHeight = 0;
    let hasRenderedFrame = false;
    let resizeObserver = null;
    let intersectionObserver = null;

    const pointer = {
      x: 0.5,
      y: 0.5,
      targetX: 0.5,
      targetY: 0.5,
      inside: false,
      energy: 0,
      lastX: 0.5,
      lastY: 0.5,
      lastMoveAt: 0,
      lastTrailAt: 0,
      lastRippleAt: 0,
      distanceSinceRipple: 0,
    };
    const trail = [];
    const trailUniforms = new Float32Array(TRAIL_COUNT * 4);

    canvas.style.visibility = "hidden";
    canvas.style.pointerEvents = "none";
    canvas.setAttribute("aria-hidden", "true");

    function isEligible() {
      return active && finePointer.matches;
    }

    function hideCanvas() {
      canvas.style.visibility = "hidden";
      canvas.classList.remove("is-ready");
    }

    function showCanvas() {
      canvas.style.visibility = "visible";
      canvas.classList.add("is-ready");
    }

    function stop() {
      if (rafId) {
        global.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      lastFrameTime = 0;
    }

    function deleteResources() {
      if (!gl || (typeof gl.isContextLost === "function" && gl.isContextLost())) {
        program = null;
        positionBuffer = null;
        texture = null;
        uniforms = null;
        return;
      }

      if (texture) {
        gl.deleteTexture(texture);
      }
      if (positionBuffer) {
        gl.deleteBuffer(positionBuffer);
      }
      if (program) {
        gl.deleteProgram(program);
      }

      program = null;
      positionBuffer = null;
      texture = null;
      uniforms = null;
    }

    function fallBack(error) {
      failed = true;
      initialized = false;
      stop();
      hideCanvas();
      deleteResources();

      // Failure is intentionally silent: the original video remains the complete fallback.
      void error;
    }

    function resize() {
      if (!initialized || !gl || destroyed) {
        return;
      }

      const canvasRect = canvas.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const cssWidth = canvasRect.width || containerRect.width;
      const cssHeight = canvasRect.height || containerRect.height;

      if (cssWidth <= 0 || cssHeight <= 0) {
        return;
      }

      const pixelRatio = Math.min(global.devicePixelRatio || 1, 1.5);
      const width = Math.max(1, Math.round(cssWidth * pixelRatio));
      const height = Math.max(1, Math.round(cssHeight * pixelRatio));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
    }

    function initialize() {
      if (destroyed || failed || initialized || !isEligible()) {
        return;
      }

      try {
        gl = canvas.getContext("webgl", {
          alpha: false,
          antialias: false,
          depth: false,
          stencil: false,
          premultipliedAlpha: false,
          preserveDrawingBuffer: false,
          powerPreference: "high-performance",
        });

        if (!gl) {
          throw new Error("WebGL 1 не поддерживается браузером.");
        }

        program = createProgram(gl);
        uniforms = getUniformLocations(gl, program);
        positionBuffer = gl.createBuffer();
        texture = gl.createTexture();

        if (!positionBuffer || !texture) {
          throw new Error("Не удалось создать WebGL-буферы.");
        }

        const positionLocation = gl.getAttribLocation(program, "a_position");
        if (positionLocation < 0) {
          throw new Error("Атрибут позиции не найден в WebGL-программе.");
        }

        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
          gl.STATIC_DRAW,
        );
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          1,
          1,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          new Uint8Array([0, 0, 0, 255]),
        );
        gl.uniform1i(uniforms.texture, 0);

        uploadedWidth = 0;
        uploadedHeight = 0;
        hasRenderedFrame = false;
        initialized = true;
        resize();
      } catch (error) {
        fallBack(error);
      }
    }

    function uploadVideoFrame() {
      if (
        video.readyState < 2
        || !video.videoWidth
        || !video.videoHeight
        || !gl
        || !texture
      ) {
        return false;
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.getError();

      try {
        if (uploadedWidth !== video.videoWidth || uploadedHeight !== video.videoHeight) {
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            video,
          );
          uploadedWidth = video.videoWidth;
          uploadedHeight = video.videoHeight;
        } else {
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            0,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            video,
          );
        }
      } catch (error) {
        fallBack(error);
        return false;
      }

      const uploadError = gl.getError();
      if (uploadError !== gl.NO_ERROR) {
        fallBack(new Error(`Ошибка загрузки видеотекстуры WebGL: ${uploadError}`));
        return false;
      }

      return true;
    }

    function fillEffectUniforms(now) {
      trailUniforms.fill(0);

      for (let index = trail.length - 1; index >= 0; index -= 1) {
        if (now - trail[index].born > TRAIL_LIFETIME) {
          trail.splice(index, 1);
        }
      }

      trail.slice(0, TRAIL_COUNT).forEach((point, index) => {
        const age = clamp((now - point.born) / TRAIL_LIFETIME, 0, 1);
        const fade = (1 - age) * (1 - age);
        const offset = index * 4;
        trailUniforms[offset] = point.x;
        trailUniforms[offset + 1] = point.y;
        trailUniforms[offset + 2] = point.strength * fade;
        trailUniforms[offset + 3] = age;
      });

    }

    function render(now) {
      rafId = 0;
      if (
        destroyed
        || failed
        || !initialized
        || !isIntersecting
        || global.document.visibilityState === "hidden"
        || !isEligible()
      ) {
        return;
      }

      const deltaSeconds = lastFrameTime
        ? clamp((now - lastFrameTime) / 1000, 0, 0.05)
        : 1 / 60;
      lastFrameTime = now;

      const pointerEase = 1 - Math.exp(-15 * deltaSeconds);
      pointer.x += (pointer.targetX - pointer.x) * pointerEase;
      pointer.y += (pointer.targetY - pointer.y) * pointerEase;
      pointer.energy *= Math.exp(-4.8 * deltaSeconds);

      if (!uploadVideoFrame()) {
        if (!failed) {
          rafId = global.requestAnimationFrame(render);
        }
        return;
      }

      const pointerStrength = clamp(pointer.energy * 0.82, 0, 0.9);
      const objectPosition = readObjectPosition(video);
      fillEffectUniforms(now);

      gl.useProgram(program);
      gl.uniform2f(uniforms.canvasSize, canvas.width, canvas.height);
      gl.uniform2f(uniforms.textureSize, video.videoWidth, video.videoHeight);
      gl.uniform2f(uniforms.objectPosition, objectPosition[0], objectPosition[1]);
      gl.uniform3f(uniforms.pointer, pointer.x, pointer.y, pointerStrength);
      gl.uniform4fv(uniforms.trail, trailUniforms);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      const drawError = gl.getError();
      if (drawError !== gl.NO_ERROR) {
        fallBack(new Error(`Ошибка отрисовки WebGL: ${drawError}`));
        return;
      }

      if (!hasRenderedFrame) {
        hasRenderedFrame = true;
        showCanvas();
      }
      rafId = global.requestAnimationFrame(render);
    }

    function start() {
      if (
        destroyed
        || failed
        || rafId
        || !initialized
        || !isIntersecting
        || global.document.visibilityState === "hidden"
        || !isEligible()
      ) {
        return;
      }

      rafId = global.requestAnimationFrame(render);
    }

    function initializeAndStart() {
      if (!initialized) {
        initialize();
      }
      start();
    }

    function normalizedPointerPosition(event) {
      const rect = canvas.getBoundingClientRect();
      const fallbackRect = container.getBoundingClientRect();
      const left = rect.width ? rect.left : fallbackRect.left;
      const top = rect.height ? rect.top : fallbackRect.top;
      const width = rect.width || fallbackRect.width || 1;
      const height = rect.height || fallbackRect.height || 1;

      return {
        x: clamp((event.clientX - left) / width, 0, 1),
        y: clamp(1 - (event.clientY - top) / height, 0, 1),
        aspect: width / height,
      };
    }

    function onPointerEnter(event) {
      if (!active || !isEligible() || event.pointerType === "touch") {
        return;
      }

      const position = normalizedPointerPosition(event);
      pointer.x = position.x;
      pointer.y = position.y;
      pointer.targetX = position.x;
      pointer.targetY = position.y;
      pointer.lastX = position.x;
      pointer.lastY = position.y;
      pointer.lastMoveAt = global.performance.now();
      pointer.lastTrailAt = pointer.lastMoveAt;
      pointer.lastRippleAt = pointer.lastMoveAt;
      pointer.distanceSinceRipple = 0;
      pointer.inside = true;
      pointer.energy = Math.max(pointer.energy, 0.1);
      initializeAndStart();
    }

    function onPointerMove(event) {
      if (!active || !isEligible() || event.pointerType === "touch") {
        return;
      }

      const now = global.performance.now();
      const position = normalizedPointerPosition(event);

      if (!pointer.inside) {
        onPointerEnter(event);
        return;
      }

      const deltaTime = Math.max((now - pointer.lastMoveAt) / 1000, 1 / 240);
      const deltaX = (position.x - pointer.lastX) * position.aspect;
      const deltaY = position.y - pointer.lastY;
      const distance = Math.hypot(deltaX, deltaY);
      const speed = distance / deltaTime;
      const strength = clamp(0.2 + speed * 0.26, 0.2, 0.72);

      pointer.targetX = position.x;
      pointer.targetY = position.y;
      pointer.energy = Math.max(pointer.energy, strength);
      pointer.distanceSinceRipple += distance;

      if (distance > 0.0015 && (now - pointer.lastTrailAt > 16 || distance > 0.009)) {
        trail.unshift({
          x: position.x,
          y: position.y,
          strength: strength * 0.72,
          born: now,
        });
        trail.length = Math.min(trail.length, TRAIL_COUNT);
        pointer.lastTrailAt = now;
      }

      pointer.lastX = position.x;
      pointer.lastY = position.y;
      pointer.lastMoveAt = now;
      start();
    }

    function onPointerLeave() {
      pointer.inside = false;
    }

    function onEligibilityChange() {
      if (!isEligible()) {
        stop();
        hideCanvas();
        return;
      }

      failed = false;
      initializeAndStart();
    }

    function onVisibilityChange() {
      if (global.document.visibilityState === "hidden") {
        stop();
      } else {
        initializeAndStart();
      }
    }

    function onContextLost(event) {
      event.preventDefault();
      stop();
      hideCanvas();
      initialized = false;
      hasRenderedFrame = false;
      program = null;
      positionBuffer = null;
      texture = null;
      uniforms = null;
      gl = null;
    }

    function onContextRestored() {
      failed = false;
      initializeAndStart();
    }

    function setActive(nextActive) {
      const next = Boolean(nextActive);
      if (active === next || destroyed) {
        return;
      }
      active = next;
      if (!active) {
        stop();
        hideCanvas();
        hasRenderedFrame = false;
        pointer.inside = false;
        pointer.energy = 0;
        trail.length = 0;
        return;
      }
      initializeAndStart();
    }

    container.addEventListener("pointerenter", onPointerEnter, { passive: true });
    container.addEventListener("pointermove", onPointerMove, { passive: true });
    container.addEventListener("pointerleave", onPointerLeave, { passive: true });
    canvas.addEventListener("webglcontextlost", onContextLost, false);
    canvas.addEventListener("webglcontextrestored", onContextRestored, false);
    video.addEventListener("loadeddata", initializeAndStart, { passive: true });
    video.addEventListener("playing", initializeAndStart, { passive: true });
    global.document.addEventListener("visibilitychange", onVisibilityChange);
    global.addEventListener("resize", resize, { passive: true });

    const removeFinePointerListener = addMediaListener(finePointer, onEligibilityChange);

    if (typeof global.ResizeObserver === "function") {
      resizeObserver = new global.ResizeObserver(resize);
      resizeObserver.observe(container);
    }

    if (typeof global.IntersectionObserver === "function") {
      intersectionObserver = new global.IntersectionObserver((entries) => {
        const entry = entries[0];
        isIntersecting = Boolean(entry && entry.isIntersecting && entry.intersectionRatio > 0);
        if (isIntersecting) {
          initializeAndStart();
        } else {
          stop();
        }
      }, { threshold: 0.01 });
      intersectionObserver.observe(container);
    } else {
      isIntersecting = true;
    }

    function destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      stop();

      container.removeEventListener("pointerenter", onPointerEnter);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      video.removeEventListener("loadeddata", initializeAndStart);
      video.removeEventListener("playing", initializeAndStart);
      global.document.removeEventListener("visibilitychange", onVisibilityChange);
      global.removeEventListener("resize", resize);
      removeFinePointerListener();

      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (intersectionObserver) {
        intersectionObserver.disconnect();
      }

      deleteResources();
      gl = null;
      initialized = false;
      canvas.width = originalCanvasState.width;
      canvas.height = originalCanvasState.height;
      canvas.style.visibility = originalCanvasState.visibility;
      canvas.style.pointerEvents = originalCanvasState.pointerEvents;
      canvas.classList.toggle("is-ready", originalCanvasState.readyClass);

      if (originalCanvasState.ariaHidden === null) {
        canvas.removeAttribute("aria-hidden");
      } else {
        canvas.setAttribute("aria-hidden", originalCanvasState.ariaHidden);
      }

      mounts.delete(canvas);
    }

    const controller = Object.freeze({
      destroy,
      cleanup: destroy,
      setActive,
    });
    mounts.set(canvas, controller);

    if (isEligible()) {
      initialize();
    }

    return controller;
  }

  global.RinaWaterEffect = Object.freeze({ mount });
  global.dispatchEvent(new CustomEvent("rina-water-effect-ready"));
}(window));
