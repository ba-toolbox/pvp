"use strict";
const JST = "Asia/Tokyo";
const ABOVE = 1;
const BELOW = 10;
const CENTER_INDEX = ABOVE;
const IMAGE_WIDTH = 300;
const IMAGE_HEIGHT = 288;
const SECONDS_PER_DAY = IMAGE_WIDTH * IMAGE_HEIGHT;
const PERMUTATION_COUNT = 720;
const FACTORIALS = [1, 1, 2, 6, 24, 120, 720];
const MISSING_PERMUTATION = ["?", "?", "?", "?", "?", "?"];
const TICK_ANIMATION_MS = 200;
const IMAGE_FETCH_SECOND = 30;
const DAY_OVERSCAN = 8;
const listElement = document.getElementById("list");
if (!(listElement instanceof HTMLUListElement)) {
    throw new Error("Missing #list element");
}
const dayScrollElement = document.getElementById("day-scroll");
const dayScrollContentElement = document.getElementById("day-scroll-content");
if (!(dayScrollElement instanceof HTMLDivElement)) {
    throw new Error("Missing #day-scroll element");
}
if (!(dayScrollContentElement instanceof HTMLDivElement)) {
    throw new Error("Missing #day-scroll-content element");
}
const listEl = listElement;
const dayScrollEl = dayScrollElement;
const dayScrollContentEl = dayScrollContentElement;
let animating = false;
let currentBase;
let items;
let tickFrameId;
let animationBoundary;
let pendingBase;
let pendingItems;
let lastJstFetchMinute;
let dayListCurrentIndex = -1;
let lastDayListJstSecond = -1;
let dayListScrollRenderPending = false;
const imageCache = new Map();
const prefetchInFlight = new Set();
function currentZonedSecond() {
    const now = Temporal.Now.zonedDateTimeISO();
    return now.with({ millisecond: 0, microsecond: 0, nanosecond: 0 });
}
function currentJstZoned() {
    const now = Temporal.Now.zonedDateTimeISO(JST);
    return now.with({ millisecond: 0, microsecond: 0, nanosecond: 0 });
}
function isAfternoonJst() {
    return currentJstZoned().hour >= 12;
}
function imagePathForDate(plainDate) {
    return `${plainDate.toString()}.png`;
}
function formatTime(zonedDateTime) {
    return zonedDateTime.toPlainTime().toString({ smallestUnit: "second" });
}
function zonedAt(baseZoned, offsetSeconds) {
    return baseZoned.add({ seconds: offsetSeconds });
}
function secondOfDay(zonedDateTime) {
    const { hour, minute, second } = zonedDateTime.toPlainTime();
    return hour * 3600 + minute * 60 + second;
}
function wrapSecondOfDay(index) {
    return ((index % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
}
function getDayRowHeight() {
    const dayList = dayScrollEl.closest(".day-list");
    if (dayList instanceof HTMLElement) {
        const height = Number.parseFloat(getComputedStyle(dayList).getPropertyValue("--day-row-height"));
        if (!Number.isNaN(height) && height > 0) {
            return height;
        }
    }
    return 26;
}
function formatJstTimeFromSecondOfDay(index) {
    const wrapped = wrapSecondOfDay(index);
    const hour = Math.floor(wrapped / 3600);
    const minute = Math.floor((wrapped % 3600) / 60);
    const second = wrapped % 60;
    const pad = (value) => String(value).padStart(2, "0");
    return `${pad(hour)}:${pad(minute)}:${pad(second)}`;
}
function permutationsForJstSecondOfDay(index) {
    const imageData = imageCache.get(currentJstZoned().toPlainDate().toString());
    if (!imageData) {
        return {
            leftPermutation: MISSING_PERMUTATION,
            rightPermutation: MISSING_PERMUTATION,
        };
    }
    return extractPermutationFromImage(imageData, index);
}
function renderSmallPermutation(permutation) {
    return permutation
        .map((value) => `<span class="day-list__num">${value}</span>`)
        .join("");
}
function renderDayListRow(index, rowHeight) {
    const currentClass = index === dayListCurrentIndex ? " day-list__row--current" : "";
    const { leftPermutation, rightPermutation } = permutationsForJstSecondOfDay(index);
    return `<div class="day-list__row${currentClass}" data-index="${index}" style="top:${index * rowHeight}px;height:${rowHeight}px">
    <span class="day-list__time">${formatJstTimeFromSecondOfDay(index)}</span>
    <div class="day-list__perm">${renderSmallPermutation(leftPermutation)}</div>
    <div class="day-list__perm">${renderSmallPermutation(rightPermutation)}</div>
  </div>`;
}
function renderDayVirtualList() {
    const rowHeight = getDayRowHeight();
    const scrollTop = dayScrollEl.scrollTop;
    const viewHeight = dayScrollEl.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - DAY_OVERSCAN);
    const end = Math.min(SECONDS_PER_DAY - 1, Math.ceil((scrollTop + viewHeight) / rowHeight) + DAY_OVERSCAN);
    dayScrollContentEl.style.height = `${SECONDS_PER_DAY * rowHeight}px`;
    const rows = [];
    for (let index = start; index <= end; index += 1) {
        rows.push(renderDayListRow(index, rowHeight));
    }
    dayScrollContentEl.innerHTML = rows.join("");
}
function scrollDayListToIndex(index) {
    const rowHeight = getDayRowHeight();
    const target = index * rowHeight - dayScrollEl.clientHeight / 2 + rowHeight / 2;
    const maxScroll = Math.max(0, SECONDS_PER_DAY * rowHeight - dayScrollEl.clientHeight);
    dayScrollEl.scrollTop = Math.min(maxScroll, Math.max(0, target));
}
function updateDayListHighlight() {
    const jstSecond = secondOfDay(currentJstZoned());
    if (jstSecond === lastDayListJstSecond) {
        return;
    }
    lastDayListJstSecond = jstSecond;
    dayListCurrentIndex = jstSecond;
    renderDayVirtualList();
}
function initDayVirtualList() {
    dayListCurrentIndex = secondOfDay(currentJstZoned());
    lastDayListJstSecond = dayListCurrentIndex;
    scrollDayListToIndex(dayListCurrentIndex);
    renderDayVirtualList();
    dayScrollEl.addEventListener("scroll", () => {
        if (dayListScrollRenderPending) {
            return;
        }
        dayListScrollRenderPending = true;
        requestAnimationFrame(() => {
            dayListScrollRenderPending = false;
            renderDayVirtualList();
        });
    }, { passive: true });
}
function millisecondsUntilInstant(target) {
    const now = Temporal.Now.instant();
    return Math.max(0, now.until(target, { largestUnit: "millisecond" }).total("milliseconds"));
}
function nextBoundaryInstant(baseZoned) {
    return baseZoned.add({ seconds: 1 }).toInstant();
}
function nthPermutation(index) {
    let remainder = ((index % PERMUTATION_COUNT) + PERMUTATION_COUNT) % PERMUTATION_COUNT;
    const pool = [1, 2, 3, 4, 5, 6];
    const result = [];
    for (let i = 0; i < 6; i += 1) {
        const factorial = FACTORIALS[5 - i];
        const pick = Math.floor(remainder / factorial);
        remainder %= factorial;
        result.push(pool[pick]);
        pool.splice(pick, 1);
    }
    return result;
}
function extractPermutationFromPixel(r, g, b) {
    const pixel = (r << 16) | (g << 8) | b;
    const leftBits = (pixel >> 12) & 0xfff;
    const rightBits = pixel & 0xfff;
    return {
        leftPermutation: nthPermutation(leftBits),
        rightPermutation: nthPermutation(rightBits),
    };
}
function extractPermutationFromImage(imageData, secondOfDayIndex) {
    const wrappedSecond = ((secondOfDayIndex % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
    const x = wrappedSecond % imageData.width;
    const y = Math.floor(wrappedSecond / imageData.width);
    const offset = (y * imageData.width + x) * 4;
    const { data } = imageData;
    return extractPermutationFromPixel(data[offset], data[offset + 1], data[offset + 2]);
}
function readImageDataFromFile(src) {
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = IMAGE_WIDTH;
            canvas.height = IMAGE_HEIGHT;
            const context = canvas.getContext("2d");
            if (!context) {
                resolve(null);
                return;
            }
            context.drawImage(image, 0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
            resolve(context.getImageData(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT));
        };
        image.onerror = () => {
            resolve(null);
        };
        image.src = src;
    });
}
async function loadPermutationImageForDate(plainDate) {
    const dateKey = plainDate.toString();
    const cached = imageCache.get(dateKey);
    if (cached) {
        return cached;
    }
    const imageData = await readImageDataFromFile(imagePathForDate(plainDate));
    if (imageData) {
        imageCache.set(dateKey, imageData);
    }
    return imageData;
}
function prefetchPermutationImageForDate(plainDate) {
    const dateKey = plainDate.toString();
    if (imageCache.has(dateKey) || prefetchInFlight.has(dateKey)) {
        return;
    }
    prefetchInFlight.add(dateKey);
    void loadPermutationImageForDate(plainDate).finally(() => {
        prefetchInFlight.delete(dateKey);
    });
}
function isJstImageFetchSecond() {
    return currentJstZoned().second === IMAGE_FETCH_SECOND;
}
function jstFetchMinuteKey() {
    const jst = currentJstZoned();
    const { hour, minute } = jst;
    return `${jst.toPlainDate().toString()}T${hour}:${minute}`;
}
async function ensureTodayJstImage() {
    const todayJst = currentJstZoned().toPlainDate();
    const imageData = await loadPermutationImageForDate(todayJst);
    if (imageData) {
        if (!animating) {
            items = buildItems(currentBase);
            renderItems(items, CENTER_INDEX);
        }
        renderDayVirtualList();
    }
}
function prefetchTomorrowIfAfternoonJst() {
    if (!isAfternoonJst()) {
        return;
    }
    const tomorrowJst = currentJstZoned().toPlainDate().add({ days: 1 });
    prefetchPermutationImageForDate(tomorrowJst);
}
function fetchJstImages() {
    void ensureTodayJstImage();
    prefetchTomorrowIfAfternoonJst();
}
function refreshJstImages() {
    if (!isJstImageFetchSecond()) {
        return;
    }
    const minuteKey = jstFetchMinuteKey();
    if (lastJstFetchMinute === minuteKey) {
        return;
    }
    lastJstFetchMinute = minuteKey;
    fetchJstImages();
}
function permutationsFor(localZoned) {
    const jstZoned = localZoned.withTimeZone(JST);
    const imageData = imageCache.get(jstZoned.toPlainDate().toString());
    if (!imageData) {
        return {
            leftPermutation: MISSING_PERMUTATION,
            rightPermutation: MISSING_PERMUTATION,
        };
    }
    return extractPermutationFromImage(imageData, secondOfDay(jstZoned));
}
function createItem(localZoned) {
    const { leftPermutation, rightPermutation } = permutationsFor(localZoned);
    return {
        time: formatTime(localZoned),
        leftPermutation,
        rightPermutation,
    };
}
function buildItems(baseZoned) {
    const result = [];
    for (let i = -ABOVE; i <= BELOW; i += 1) {
        result.push(createItem(zonedAt(baseZoned, i)));
    }
    return result;
}
function advanceItems(previous, baseZoned) {
    return [...previous.slice(1), createItem(zonedAt(baseZoned, BELOW))];
}
function renderPermutation(permutation) {
    return permutation
        .map((value) => `<span class="clock__num">${value}</span>`)
        .join("");
}
function renderItems(items, currentIndex) {
    listEl.innerHTML = items
        .map((item, index) => {
        const currentClass = index === currentIndex ? " clock__item--current" : "";
        return `<li class="clock__item${currentClass}">
        <div class="clock__perm">${renderPermutation(item.leftPermutation)}</div>
        <span class="clock__time">${item.time}</span>
        <div class="clock__perm">${renderPermutation(item.rightPermutation)}</div>
      </li>`;
    })
        .join("");
}
function getItemHeight() {
    const firstItem = listEl.querySelector(".clock__item");
    return firstItem instanceof HTMLElement ? firstItem.offsetHeight : 56;
}
function resetListPosition() {
    listEl.classList.add("clock__list--instant");
    listEl.style.transform = "translateY(0)";
    void listEl.offsetHeight;
    listEl.classList.remove("clock__list--instant");
}
function wallSecond() {
    return currentZonedSecond();
}
function isAtOrPastSecond(target) {
    return Temporal.ZonedDateTime.compare(wallSecond(), target) >= 0;
}
function clampCurrentBaseToWall() {
    const wall = wallSecond();
    if (Temporal.ZonedDateTime.compare(currentBase, wall) <= 0) {
        return;
    }
    currentBase = wall;
    items = buildItems(currentBase);
    renderItems(items, CENTER_INDEX);
    resetListPosition();
}
function snapIfBehind() {
    const wall = wallSecond();
    const nextBase = currentBase.add({ seconds: 1 });
    if (Temporal.ZonedDateTime.compare(wall, nextBase) <= 0) {
        return;
    }
    currentBase = wall;
    items = buildItems(currentBase);
    renderItems(items, CENTER_INDEX);
    resetListPosition();
}
function commitTick(nextBase) {
    if (!isAtOrPastSecond(nextBase)) {
        return;
    }
    if (Temporal.ZonedDateTime.compare(nextBase, currentBase) <= 0) {
        return;
    }
    currentBase = nextBase;
    items = advanceItems(items, currentBase);
    renderItems(items, CENTER_INDEX);
    resetListPosition();
}
function finishAnimation() {
    if (!animating || animationBoundary === undefined || pendingBase === undefined || pendingItems === undefined) {
        return;
    }
    if (millisecondsUntilInstant(animationBoundary) > 0) {
        return;
    }
    if (!isAtOrPastSecond(pendingBase)) {
        return;
    }
    listEl.style.transitionDuration = "";
    listEl.style.transitionTimingFunction = "";
    currentBase = pendingBase;
    items = pendingItems;
    renderItems(items, CENTER_INDEX);
    animating = false;
    animationBoundary = undefined;
    pendingBase = undefined;
    pendingItems = undefined;
}
function beginAnimation(nextBase, boundaryInstant) {
    if (animating) {
        return;
    }
    animating = true;
    animationBoundary = boundaryInstant;
    pendingBase = nextBase;
    pendingItems = advanceItems(items, pendingBase);
    const animationMs = Math.max(1, millisecondsUntilInstant(boundaryInstant));
    renderItems(pendingItems, CENTER_INDEX - 1);
    const itemHeight = getItemHeight();
    listEl.classList.add("clock__list--instant");
    listEl.style.transform = `translateY(${itemHeight}px)`;
    void listEl.offsetHeight;
    listEl.classList.remove("clock__list--instant");
    listEl.style.transitionDuration = `${animationMs}ms`;
    listEl.style.transitionTimingFunction = "linear";
    listEl.style.transform = "translateY(0)";
}
function runClockTick() {
    refreshJstImages();
    updateDayListHighlight();
    if (animating) {
        finishAnimation();
        return;
    }
    clampCurrentBaseToWall();
    snapIfBehind();
    const nextBase = currentBase.add({ seconds: 1 });
    const boundaryInstant = nextBoundaryInstant(currentBase);
    const msUntilBoundary = millisecondsUntilInstant(boundaryInstant);
    if (msUntilBoundary <= 0) {
        commitTick(nextBase);
        return;
    }
    if (msUntilBoundary <= TICK_ANIMATION_MS) {
        beginAnimation(nextBase, boundaryInstant);
    }
}
function startClockLoop() {
    if (tickFrameId !== undefined) {
        return;
    }
    const loop = () => {
        tickFrameId = requestAnimationFrame(loop);
        runClockTick();
    };
    tickFrameId = requestAnimationFrame(loop);
}
async function init() {
    currentBase = currentZonedSecond();
    items = buildItems(currentBase);
    renderItems(items, CENTER_INDEX);
    resetListPosition();
    await ensureTodayJstImage();
    prefetchTomorrowIfAfternoonJst();
    if (isJstImageFetchSecond()) {
        lastJstFetchMinute = jstFetchMinuteKey();
    }
    initDayVirtualList();
    startClockLoop();
}
void init();
