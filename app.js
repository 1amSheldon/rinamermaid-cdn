// app.js
// Rina Mermaid Academy
// Created by RxGroup on 15.07.2026.
// Copyright © 2026 RX Group. All rights reserved.

document.documentElement.classList.replace("no-js", "js");

const coarsePointer = window.matchMedia("(pointer: coarse)");
const mobileViewport = window.matchMedia("(max-width: 48rem)");
const story = document.querySelector("[data-story]");
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function loadVideo(video, { autoplay = false, useMirror = false } = {}) {
  if (!video) return;
  const desktopSource = useMirror ? video.dataset.fallbackSrc : video.dataset.primarySrc;
  const mobileSource = useMirror ? video.dataset.mobileFallbackSrc : video.dataset.mobilePrimarySrc;
  const source = mobileViewport.matches && mobileSource ? mobileSource : desktopSource;
  if (!source || video.getAttribute("src") === source) return false;
  if (useMirror) video.crossOrigin = "anonymous";
  video.dataset.videoSource = useMirror ? "mirror" : "origin";
  video.src = source;
  video.load();
  if (autoplay) video.play().catch(() => {});
  return true;
}

function setupStory() {
  if (!story) return;

  const stage = story.querySelector("[data-stage]");
  const surface = story.querySelector("[data-surface-video]");
  const film = story.querySelector("[data-scroll-film]");
  const canvas = story.querySelector("[data-water-canvas='story']");
  const scenes = [...story.querySelectorAll("[data-story-scene]")];
  const bookingScene = story.querySelector("[data-booking]");
  const bookingPanel = bookingScene?.querySelector(".story-scene__inner");
  const backToTop = document.querySelector("[data-back-to-top]");
  const useWaterEffect = !coarsePointer.matches;

  let animationFrame = 0;
  let experienceVisible = true;
  let motionEnabled = true;
  let filmReady = false;
  let filmVisibleReady = false;
  let filmRequested = false;
  let filmSeekTimer = 0;
  let filmLoadTimer = 0;
  let surfaceLoadTimer = 0;
  let surfaceStartTime = null;
  let pendingFilmTime = 0;
  let filmStartY = 0;
  let settleStartY = 0;
  let settleEndY = 0;
  let crossfadeEndY = 0;
  let sceneAnchors = [];
  let storyTopY = 0;
  let storyRange = 1;
  let bookingTravel = 0;

  surface?.setAttribute("aria-hidden", "true");
  film?.setAttribute("aria-hidden", "true");

  const waterController = useWaterEffect
    && window.RinaWaterEffect?.mount
    && stage
    && surface
    && canvas
    ? window.RinaWaterEffect.mount({ container: stage, video: surface, canvas })
    : null;

  const smoothstep = (value) => value * value * (3 - 2 * value);

  function showFilmFallback() {
    filmVisibleReady = false;
    story.style.setProperty("--film-ready", "0");
  }

  function showFilmFrame() {
    window.clearTimeout(filmSeekTimer);
    if (!filmVisibleReady) {
      filmVisibleReady = true;
      story.style.setProperty("--film-ready", "1");
    }
  }

  function armFilmFallback() {
    window.clearTimeout(filmSeekTimer);
    filmSeekTimer = window.setTimeout(() => {
      if (!film || Math.abs(film.currentTime - pendingFilmTime) > 0.08) {
        showFilmFallback();
      }
    }, 1200);
  }

  function switchToMirror(video, { autoplay = false } = {}) {
    if (!video || video.dataset.videoSource === "mirror") return false;
    return loadVideo(video, { autoplay, useMirror: true });
  }

  function armSurfaceMirror() {
    window.clearTimeout(surfaceLoadTimer);
    surfaceLoadTimer = window.setTimeout(() => {
      if (surface && surface.readyState < 2) switchToMirror(surface, { autoplay: true });
    }, 3500);
  }

  function armFilmMirror() {
    window.clearTimeout(filmLoadTimer);
    filmLoadTimer = window.setTimeout(() => {
      if (film && film.readyState < 2 && switchToMirror(film)) {
        filmReady = false;
        showFilmFallback();
      }
    }, 3500);
  }

  if (motionEnabled && loadVideo(surface, { autoplay: true })) armSurfaceMirror();

  function ensureFilmLoaded() {
    if (!film) return;
    if (film.readyState >= 2) {
      filmReady = true;
      return;
    }
    if (filmRequested && film.currentSrc) return;
    filmRequested = true;
    film.preload = "metadata";
    if (loadVideo(film)) armFilmMirror();
    filmReady = film.readyState >= 2;
  }

  function measure() {
    const currentScroll = window.scrollY;
    const storyRect = story.getBoundingClientRect();
    storyTopY = currentScroll + storyRect.top;
    storyRange = Math.max(1, story.offsetHeight - window.innerHeight);
    sceneAnchors = scenes.map((scene) => {
      const rect = scene.getBoundingClientRect();
      const top = currentScroll + rect.top - storyTopY;
      const anchor = top;
      const time = Number.parseFloat(scene.dataset.sceneTime);
      return { scene, top, anchor, time: Number.isFinite(time) ? time : null };
    });

    const firstFilmScene = sceneAnchors.find((item) => item.time !== null);
    if (firstFilmScene) {
      filmStartY = Math.max(0, firstFilmScene.top - window.innerHeight * 0.44);
      settleStartY = Math.max(0, filmStartY - window.innerHeight * 0.28);
      settleEndY = filmStartY + window.innerHeight * 0.04;
      crossfadeEndY = filmStartY + window.innerHeight * 0.22;
    }

    bookingTravel = mobileViewport.matches && bookingPanel
      ? Math.max(0, bookingPanel.scrollHeight - bookingPanel.clientHeight + 48)
      : 0;
  }

  function renderScenes(currentY) {
    if (!sceneAnchors.length) return;

    let current = sceneAnchors[0];
    let next = null;
    let local = 0;
    let fadeOut = 0;
    let fadeIn = 0;

    if (currentY >= sceneAnchors.at(-1).anchor) {
      current = sceneAnchors.at(-1);
    } else if (currentY > sceneAnchors[0].anchor) {
      for (let index = 0; index < sceneAnchors.length - 1; index += 1) {
        const candidate = sceneAnchors[index];
        const following = sceneAnchors[index + 1];
        if (currentY > following.anchor) continue;
        current = candidate;
        next = following;
        local = clamp((currentY - candidate.anchor) / Math.max(1, following.anchor - candidate.anchor));
        fadeOut = smoothstep(clamp((local - 0.32) / 0.16));
        fadeIn = smoothstep(clamp((local - 0.52) / 0.16));
        break;
      }
    }

    sceneAnchors.forEach((item) => {
      let opacity = 0;
      let shift = 1.2;
      if (item === current) {
        opacity = 1 - fadeOut;
        shift = -0.8 * fadeOut;
      } else if (item === next) {
        opacity = fadeIn;
        shift = 0.8 * (1 - fadeIn);
      }
      item.scene.style.setProperty("--scene-opacity", opacity.toFixed(4));
      item.scene.style.setProperty("--scene-shift", `${shift.toFixed(3)}rem`);
    });

    const bookingAnchor = sceneAnchors.find((item) => item.scene === bookingScene);
    if (bookingScene && bookingAnchor) {
      const bookingProgress = clamp(
        (currentY - bookingAnchor.anchor) / Math.max(1, storyRange - bookingAnchor.anchor),
      );
      bookingScene.style.setProperty(
        "--booking-shift",
        `${(bookingTravel * bookingProgress).toFixed(2)}px`,
      );
    }

    const activeItem = next && local >= 0.5 ? next : current;
    scenes.forEach((scene) => {
      const active = scene === activeItem.scene;
      scene.classList.toggle("is-active", active);
      scene.toggleAttribute("inert", !active);
    });
    story.dataset.scene = activeItem.scene.id || "top";
    const showBackToTop = activeItem.scene === bookingScene;
    backToTop?.classList.toggle("is-visible", showBackToTop);
    backToTop?.setAttribute("aria-hidden", String(!showBackToTop));
    if (backToTop) backToTop.tabIndex = showBackToTop ? 0 : -1;
  }

  function targetFilmTime(currentY) {
    const timedAnchors = sceneAnchors.filter((item) => item.time !== null);
    if (!timedAnchors.length) return 0;
    const points = [{ anchor: filmStartY, time: 0 }, ...timedAnchors];

    if (currentY <= points[0].anchor) return 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      if (currentY > next.anchor) continue;
      const local = clamp((currentY - current.anchor) / Math.max(1, next.anchor - current.anchor));
      return current.time + (next.time - current.time) * smoothstep(local);
    }
    return points.at(-1).time;
  }

  function seekFilm(time) {
    if (!film) return;
    const maximumTime = Number.isFinite(film.duration) && film.duration > 0
      ? Math.max(0, film.duration - (1 / 24))
      : Math.max(0, time);
    pendingFilmTime = clamp(time, 0, maximumTime);
    if (!filmReady || !Number.isFinite(film.duration) || film.duration <= 0) return;
    if (Math.abs(film.currentTime - pendingFilmTime) <= 0.028) {
      showFilmFrame();
    } else if (!film.seeking) {
      film.currentTime = pendingFilmTime;
      armFilmFallback();
    }
  }

  function settleSurface(currentY) {
    if (!surface || !Number.isFinite(surface.duration) || surface.duration <= 0) return;
    if (currentY <= settleStartY) {
      surfaceStartTime = null;
      return;
    }
    if (surfaceStartTime === null) {
      surfaceStartTime = Math.min(surface.currentTime, Math.max(0, surface.duration - 0.05));
    }
    const local = smoothstep(clamp((currentY - settleStartY) / Math.max(1, settleEndY - settleStartY)));
    const endTime = Math.max(0, surface.duration - (1 / 24));
    const target = surfaceStartTime + (endTime - surfaceStartTime) * local;
    if (Math.abs(surface.currentTime - target) > 0.018) surface.currentTime = target;
  }

  function syncSurface(currentY) {
    const shouldPlay = motionEnabled
      && !document.hidden
      && experienceVisible
      && currentY <= settleStartY + 2;
    if (shouldPlay) surface?.play().catch(() => {});
    else surface?.pause();
    film?.pause();
  }

  function render() {
    animationFrame = 0;
    const currentY = clamp(window.scrollY - storyTopY, 0, storyRange);
    if (currentY > 2) ensureFilmLoaded();
    const filmMix = smoothstep(clamp((currentY - filmStartY) / Math.max(1, crossfadeEndY - filmStartY)));
    const transitionVeil = 4 * filmMix * (1 - filmMix);
    const fallbackProgress = clamp(targetFilmTime(currentY) / 21.85);
    const fallbackMiddleIn = smoothstep(clamp(fallbackProgress / 0.22));
    const fallbackEndIn = smoothstep(clamp((fallbackProgress - 0.72) / 0.28));

    story.style.setProperty("--film-mix", String(filmMix));
    story.style.setProperty("--transition-veil", String(transitionVeil));
    story.style.setProperty("--fallback-progress", String(fallbackProgress));
    story.style.setProperty("--fallback-start-opacity", String(filmMix));
    story.style.setProperty("--fallback-middle-opacity", String(filmMix * fallbackMiddleIn * (1 - fallbackEndIn)));
    story.style.setProperty("--fallback-end-opacity", String(filmMix * fallbackEndIn));
    story.classList.toggle("is-submerged", filmMix >= 0.5);

    const filmTime = fallbackProgress * 21.85;

    renderScenes(currentY);
    settleSurface(currentY);
    seekFilm(filmTime);
    waterController?.setActive(motionEnabled && currentY < crossfadeEndY);
    syncSurface(currentY);
  }

  function requestRender() {
    if (!animationFrame) animationFrame = window.requestAnimationFrame(render);
  }

  function remeasure() {
    measure();
    requestRender();
  }

  film?.addEventListener("loadeddata", () => {
    window.clearTimeout(filmLoadTimer);
    filmReady = true;
    requestRender();
  }, { passive: true });
  film?.addEventListener("loadedmetadata", requestRender, { passive: true });
  film?.addEventListener("canplay", () => {
    filmReady = true;
    requestRender();
  }, { passive: true });
  film?.addEventListener("error", () => {
    window.clearTimeout(filmLoadTimer);
    if (switchToMirror(film)) {
      filmReady = false;
      showFilmFallback();
      return;
    }
    filmReady = false;
    filmRequested = true;
    window.clearTimeout(filmSeekTimer);
    showFilmFallback();
  }, { passive: true });
  surface?.addEventListener("loadeddata", () => {
    window.clearTimeout(surfaceLoadTimer);
    requestRender();
  }, { passive: true });
  surface?.addEventListener("loadedmetadata", requestRender, { passive: true });
  surface?.addEventListener("error", () => {
    window.clearTimeout(surfaceLoadTimer);
    switchToMirror(surface, { autoplay: true });
  }, { passive: true });
  film?.addEventListener("seeked", () => {
    if (Math.abs(film.currentTime - pendingFilmTime) > 0.028) {
      film.currentTime = pendingFilmTime;
      armFilmFallback();
    } else {
      showFilmFrame();
    }
  }, { passive: true });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => {
      experienceVisible = entry.isIntersecting;
      requestRender();
    }, { threshold: 0.01 }).observe(story);
  }

  document.addEventListener("visibilitychange", requestRender);
  window.addEventListener("touchstart", ensureFilmLoaded, { once: true, passive: true });
  window.addEventListener("wheel", ensureFilmLoaded, { once: true, passive: true });
  window.addEventListener("keydown", ensureFilmLoaded, { once: true });
  window.addEventListener("scroll", requestRender, { passive: true });
  window.addEventListener("resize", remeasure, { passive: true });
  window.addEventListener("load", remeasure, { once: true });
  document.fonts?.ready.then(remeasure).catch(() => {});
  measure();
  render();
}

function setupCourseSelection() {
  const select = document.querySelector("#course");
  const picker = document.querySelector("[data-course-picker]");
  const trigger = picker?.querySelector("[data-course-trigger]");
  const value = picker?.querySelector("[data-course-value]");
  const menu = picker?.querySelector("[data-course-menu]");
  const options = [...(picker?.querySelectorAll("[data-course-option]") || [])];
  const summaryTitle = document.querySelector("[data-course-summary-title]");
  const summaryText = document.querySelector("[data-course-summary-text]");
  const courseSummaries = {
    "not-sure": {
      title: "Помогу выбрать программу",
      text: "Оставьте заявку, и Рина подберёт подходящий формат занятия.",
    },
    discover: {
      title: "Discover Mermaid Experience · 6 000 ₽",
      text: "1,5 часа, погружение до 1,5 метра и памятный сертификат. Сертификация PADI не предусмотрена.",
    },
    basic: {
      title: "Basic Mermaid PADI · 9 000 ₽",
      text: "Теория и одно занятие в бассейне. По окончании вы получаете квалификацию Basic Mermaid PADI.",
    },
    mermaid: {
      title: "Mermaid PADI · 22 000 ₽",
      text: "Теория и три занятия в бассейне. По окончании вы получаете квалификацию Mermaid PADI.",
    },
    advanced: {
      title: "Advanced Mermaid PADI · 22 000 ₽",
      text: "Теория, одно занятие в бассейне и два погружения в открытой воде. По окончании вы получаете квалификацию Advanced Mermaid PADI.",
    },
  };

  function selectedOption() {
    return options.find((option) => option.dataset.courseOption === select?.value) || options[0];
  }

  function sync() {
    if (!select || !value) return;
    const nativeOption = select.options[select.selectedIndex];
    value.textContent = nativeOption?.textContent?.replace(/\s+·\s+[\d\s]+₽$/, "") || "Пока выбираю";
    options.forEach((option) => {
      option.setAttribute("aria-selected", String(option.dataset.courseOption === select.value));
    });
    const summary = courseSummaries[select.value] || courseSummaries["not-sure"];
    if (summaryTitle) summaryTitle.textContent = summary.title;
    if (summaryText) summaryText.textContent = summary.text;
  }

  function close({ restoreFocus = false } = {}) {
    if (!trigger || !menu) return;
    trigger.setAttribute("aria-expanded", "false");
    menu.hidden = true;
    if (restoreFocus) trigger.focus();
  }

  function open() {
    if (!trigger || !menu) return;
    trigger.setAttribute("aria-expanded", "true");
    menu.hidden = false;
    selectedOption()?.focus();
  }

  trigger?.addEventListener("click", () => {
    if (menu?.hidden) open();
    else close();
  });

  options.forEach((option) => {
    option.addEventListener("click", () => {
      if (!select) return;
      select.value = option.dataset.courseOption;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      close({ restoreFocus: true });
    });
  });

  picker?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close({ restoreFocus: true });
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (menu?.hidden) {
      open();
      return;
    }
    const currentIndex = Math.max(0, options.indexOf(document.activeElement));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[nextIndex]?.focus();
  });

  document.addEventListener("pointerdown", (event) => {
    if (picker && !picker.contains(event.target)) close();
  });

  select?.addEventListener("change", sync);
  select?.form?.addEventListener("reset", () => requestAnimationFrame(sync));

  document.querySelectorAll("[data-course]").forEach((link) => {
    link.addEventListener("click", () => {
      if (!select) return;
      select.value = link.dataset.course;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  sync();
}

function setupPhoneMask() {
  const input = document.querySelector("input[name='phone']");
  if (!input) return;

  function formatPhone(rawValue) {
    let digits = String(rawValue || "").replace(/\D/g, "");
    if (digits.startsWith("8")) digits = `7${digits.slice(1)}`;
    if (!digits.startsWith("7")) digits = `7${digits}`;
    digits = digits.slice(0, 11);
    const local = digits.slice(1);
    let formatted = "+7";
    if (local.length) formatted += ` (${local.slice(0, 3)}`;
    if (local.length >= 3) formatted += ")";
    if (local.length > 3) formatted += ` ${local.slice(3, 6)}`;
    if (local.length > 6) formatted += `-${local.slice(6, 8)}`;
    if (local.length > 8) formatted += `-${local.slice(8, 10)}`;
    return formatted;
  }

  input.addEventListener("focus", () => {
    if (!input.value) input.value = "+7";
  });
  input.addEventListener("input", () => {
    input.value = formatPhone(input.value);
  });
  input.addEventListener("blur", () => {
    if (input.value === "+7") input.value = "";
  });
}

function setupForm() {
  const form = document.querySelector("[data-booking-form]");
  const status = document.querySelector("[data-form-status]");
  const submit = document.querySelector("[data-submit]");
  if (!form || !status || !submit) return;

  const fields = [...form.querySelectorAll("input:not([name='website']), select, textarea")];
  let submissionKey = "";

  function getSubmissionKey() {
    if (submissionKey) return submissionKey;
    submissionKey = globalThis.crypto?.randomUUID?.()
      || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    return submissionKey;
  }

  function setStatus(message, type = "") {
    status.textContent = message;
    status.className = `form-status form-field--wide${type ? ` is-${type}` : ""}`;
  }

  function errorElement(field) {
    const id = field.getAttribute("aria-describedby")?.split(/\s+/)[0];
    return id ? document.getElementById(id) : null;
  }

  function validationMessage(field) {
    const value = String(field.value || "").trim();
    if (field.required && field.type === "checkbox" && !field.checked) {
      return "Подтвердите согласие на обработку данных.";
    }
    if (field.required && !value) return "Заполните это поле.";
    if (field.name === "fullName") {
      const parts = value.split(/\s+/).filter(Boolean);
      if (parts.length < 2 || value.length < 3) {
        return "Укажите фамилию и имя. Если отчества нет, двух слов достаточно.";
      }
    }
    if (field.name === "phone") {
      const digits = value.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 15) return "Укажите номер телефона с кодом страны.";
    }
    if (field.name === "telegram" && value) {
      const normalized = value
        .replace(/^https?:\/\/(?:t\.me|telegram\.me)\//i, "")
        .replace(/^@?/, "@");
      if (!/^@[A-Za-z0-9_]{5,32}$/.test(normalized)) return "Укажите Telegram в формате @username.";
    }
    if (!field.validity.valid) return "Проверьте значение поля.";
    return "";
  }

  function validateField(field, forcedMessage = "") {
    field.setCustomValidity("");
    const message = forcedMessage || validationMessage(field);
    if (message) field.setCustomValidity(message);
    field.toggleAttribute("aria-invalid", Boolean(message));
    if (field.id === "course") {
      document.querySelector("[data-course-trigger]")?.toggleAttribute("aria-invalid", Boolean(message));
    }
    const error = errorElement(field);
    if (error) error.textContent = message;
    return !message;
  }

  fields.forEach((field) => {
    const eventName = field.type === "checkbox" || field.tagName === "SELECT" ? "change" : "input";
    field.addEventListener(eventName, () => {
      if (field.hasAttribute("aria-invalid")) validateField(field);
    });
    field.addEventListener("blur", () => validateField(field));
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("");

    const invalid = fields.filter((field) => !validateField(field));
    if (invalid.length) {
      if (invalid[0].id === "course") document.querySelector("[data-course-trigger]")?.focus();
      else invalid[0].focus();
      setStatus("Проверьте отмеченные поля.", "error");
      return;
    }

    const data = new FormData(form);
    const payload = {
      fullName: String(data.get("fullName") || "").trim(),
      phone: String(data.get("phone") || "").trim(),
      telegram: String(data.get("telegram") || "").trim(),
      course: data.get("course"),
      comment: String(data.get("comment") || "").trim(),
      wantsShooting: data.get("wantsShooting") === "on",
      consent: data.get("consent") === "on",
      website: data.get("website"),
    };

    submit.disabled = true;
    submit.querySelector("span").textContent = "Отправляем заявку…";
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": getSubmissionKey(),
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) {
        if (result.errors) {
          const firstField = Object.keys(result.errors)[0];
          const input = form.elements.namedItem(firstField);
          if (input && typeof input.setCustomValidity === "function") {
            validateField(input, result.errors[firstField]);
            if (input.id === "course") document.querySelector("[data-course-trigger]")?.focus();
            else input.focus();
          }
          throw new Error(result.errors[firstField]);
        }
        throw new Error(result.message || "Не удалось отправить заявку.");
      }
      form.reset();
      submissionKey = "";
      fields.forEach((field) => {
        field.setCustomValidity("");
        field.removeAttribute("aria-invalid");
        const error = errorElement(field);
        if (error) error.textContent = "";
      });
      document.querySelector("[data-course-trigger]")?.removeAttribute("aria-invalid");
      const number = result.leadId ? ` № ${result.leadId}.` : ".";
      setStatus(`Заявка принята${number} Рина свяжется с вами по указанным контактам.`, "success");
    } catch (error) {
      setStatus(`${error.message} Можно написать Рине напрямую: @Rina_mermaid_teacher.`, "error");
    } finally {
      submit.disabled = false;
      submit.querySelector("span").textContent = "Отправить Рине";
    }
  });
}

document.querySelectorAll("[data-year]").forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

setupStory();
setupCourseSelection();
setupPhoneMask();
setupForm();
