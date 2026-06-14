type PermutationDigit = 1 | 2 | 3 | 4 | 5 | 6;

type Permutation = [
  PermutationDigit,
  PermutationDigit,
  PermutationDigit,
  PermutationDigit,
  PermutationDigit,
  PermutationDigit,
];

type PermutationCell = PermutationDigit | "?";

type DisplayPermutation = [
  PermutationCell,
  PermutationCell,
  PermutationCell,
  PermutationCell,
  PermutationCell,
  PermutationCell,
];

interface ClockItem {
  time: string;
  leftPermutation: DisplayPermutation;
  rightPermutation: DisplayPermutation;
}

interface ExtractedPermutations {
  leftPermutation: DisplayPermutation;
  rightPermutation: DisplayPermutation;
}

const JST = "Asia/Tokyo";
const ABOVE = 1;
const BELOW = 10;
const CENTER_INDEX = ABOVE;
const IMAGE_WIDTH = 300;
const IMAGE_HEIGHT = 288;
const SECONDS_PER_DAY = IMAGE_WIDTH * IMAGE_HEIGHT;
const PERMUTATION_COUNT = 720;
const FACTORIALS = [1, 1, 2, 6, 24, 120, 720] as const;
const MISSING_PERMUTATION: DisplayPermutation = ["?", "?", "?", "?", "?", "?"];
const TICK_ANIMATION_MS = 200;
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
let currentBase: Temporal.ZonedDateTime;
let items: ClockItem[];
let tickFrameId: number | undefined;
let animationBoundary: Temporal.Instant | undefined;
let pendingBase: Temporal.ZonedDateTime | undefined;
let pendingItems: ClockItem[] | undefined;
let dayListCurrentIndex = -1;
let lastDayListJstSecond = -1;
let dayListScrollRenderPending = false;

const imageCache = new Map<string, ImageData>();

function currentZonedSecond(): Temporal.ZonedDateTime {
  const now = Temporal.Now.zonedDateTimeISO();
  return now.with({ millisecond: 0, microsecond: 0, nanosecond: 0 });
}

function currentJstZoned(): Temporal.ZonedDateTime {
  const now = Temporal.Now.zonedDateTimeISO(JST);
  return now.with({ millisecond: 0, microsecond: 0, nanosecond: 0 });
}

function isAfternoonJst(): boolean {
  return currentJstZoned().hour >= 12;
}

function imagePathForDate(plainDate: Temporal.PlainDate): string {
  return `${plainDate.toString()}.png`;
}

function formatTime(zonedDateTime: Temporal.ZonedDateTime): string {
  return zonedDateTime.toPlainTime().toString({ smallestUnit: "second" });
}

function zonedAt(
  baseZoned: Temporal.ZonedDateTime,
  offsetSeconds: number,
): Temporal.ZonedDateTime {
  return baseZoned.add({ seconds: offsetSeconds });
}

function secondOfDay(zonedDateTime: Temporal.ZonedDateTime): number {
  const { hour, minute, second } = zonedDateTime.toPlainTime();
  return hour * 3600 + minute * 60 + second;
}

function wrapSecondOfDay(index: number): number {
  return ((index % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
}

function getDayRowHeight(): number {
  const dayList = dayScrollEl.closest(".day-list");
  if (dayList instanceof HTMLElement) {
    const height = Number.parseFloat(getComputedStyle(dayList).getPropertyValue("--day-row-height"));
    if (!Number.isNaN(height) && height > 0) {
      return height;
    }
  }
  return 26;
}

function formatJstTimeFromSecondOfDay(index: number): string {
  const wrapped = wrapSecondOfDay(index);
  const hour = Math.floor(wrapped / 3600);
  const minute = Math.floor((wrapped % 3600) / 60);
  const second = wrapped % 60;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

function permutationsForJstSecondOfDay(index: number): ExtractedPermutations {
  const imageData = imageCache.get(currentJstZoned().toPlainDate().toString());
  if (!imageData) {
    return {
      leftPermutation: MISSING_PERMUTATION,
      rightPermutation: MISSING_PERMUTATION,
    };
  }

  return extractPermutationFromImage(imageData, index);
}

function renderSmallPermutation(permutation: DisplayPermutation): string {
  return permutation
    .map((value) => `<span class="day-list__num">${value}</span>`)
    .join("");
}

function renderDayListRow(index: number, rowHeight: number): string {
  const currentClass = index === dayListCurrentIndex ? " day-list__row--current" : "";
  const { leftPermutation, rightPermutation } = permutationsForJstSecondOfDay(index);
  return `<div class="day-list__row${currentClass}" data-index="${index}" style="top:${
    index * rowHeight
  }px;height:${rowHeight}px">
    <span class="day-list__time">${formatJstTimeFromSecondOfDay(index)}</span>
    <div class="day-list__perm">${renderSmallPermutation(leftPermutation)}</div>
    <div class="day-list__perm">${renderSmallPermutation(rightPermutation)}</div>
  </div>`;
}

function renderDayVirtualList(): void {
  const rowHeight = getDayRowHeight();
  const scrollTop = dayScrollEl.scrollTop;
  const viewHeight = dayScrollEl.clientHeight;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - DAY_OVERSCAN);
  const end = Math.min(
    SECONDS_PER_DAY - 1,
    Math.ceil((scrollTop + viewHeight) / rowHeight) + DAY_OVERSCAN,
  );

  dayScrollContentEl.style.height = `${SECONDS_PER_DAY * rowHeight}px`;

  const rows: string[] = [];
  for (let index = start; index <= end; index += 1) {
    rows.push(renderDayListRow(index, rowHeight));
  }
  dayScrollContentEl.innerHTML = rows.join("");
}

function scrollDayListToIndex(index: number): void {
  const rowHeight = getDayRowHeight();
  const target = index * rowHeight - dayScrollEl.clientHeight / 2 + rowHeight / 2;
  const maxScroll = Math.max(0, SECONDS_PER_DAY * rowHeight - dayScrollEl.clientHeight);
  dayScrollEl.scrollTop = Math.min(maxScroll, Math.max(0, target));
}

function updateDayListHighlight(): void {
  const jstSecond = secondOfDay(currentJstZoned());
  if (jstSecond === lastDayListJstSecond) {
    return;
  }

  lastDayListJstSecond = jstSecond;
  dayListCurrentIndex = jstSecond;
  renderDayVirtualList();
}

function initDayVirtualList(): void {
  dayListCurrentIndex = secondOfDay(currentJstZoned());
  lastDayListJstSecond = dayListCurrentIndex;
  scrollDayListToIndex(dayListCurrentIndex);
  renderDayVirtualList();

  dayScrollEl.addEventListener(
    "scroll",
    () => {
      if (dayListScrollRenderPending) {
        return;
      }

      dayListScrollRenderPending = true;
      requestAnimationFrame(() => {
        dayListScrollRenderPending = false;
        renderDayVirtualList();
      });
    },
    { passive: true },
  );
}

function millisecondsUntilInstant(target: Temporal.Instant): number {
  const now = Temporal.Now.instant();
  return Math.max(
    0,
    now.until(target, { largestUnit: "millisecond" }).total("milliseconds"),
  );
}

function nextBoundaryInstant(baseZoned: Temporal.ZonedDateTime): Temporal.Instant {
  return baseZoned.add({ seconds: 1 }).toInstant();
}

function nthPermutation(index: number): Permutation {
  let remainder = ((index % PERMUTATION_COUNT) + PERMUTATION_COUNT) % PERMUTATION_COUNT;
  const pool: PermutationDigit[] = [1, 2, 3, 4, 5, 6];
  const result: PermutationDigit[] = [];

  for (let i = 0; i < 6; i += 1) {
    const factorial = FACTORIALS[5 - i];
    const pick = Math.floor(remainder / factorial);
    remainder %= factorial;
    result.push(pool[pick]);
    pool.splice(pick, 1);
  }

  return result as Permutation;
}

function extractPermutationFromPixel(r: number, g: number, b: number): ExtractedPermutations {
  const pixel = (r << 16) | (g << 8) | b;
  const leftBits = (pixel >> 12) & 0xfff;
  const rightBits = pixel & 0xfff;

  return {
    leftPermutation: nthPermutation(leftBits),
    rightPermutation: nthPermutation(rightBits),
  };
}

function extractPermutationFromImage(
  imageData: ImageData,
  secondOfDayIndex: number,
): ExtractedPermutations {
  const wrappedSecond =
    ((secondOfDayIndex % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  const x = wrappedSecond % imageData.width;
  const y = Math.floor(wrappedSecond / imageData.width);
  const offset = (y * imageData.width + x) * 4;
  const { data } = imageData;

  return extractPermutationFromPixel(data[offset], data[offset + 1], data[offset + 2]);
}

function readImageDataFromFile(src: string): Promise<ImageData | null> {
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

async function loadPermutationImageForDate(
  plainDate: Temporal.PlainDate,
): Promise<ImageData | null> {
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

async function loadInitialImages(): Promise<void> {
  const todayJst = currentJstZoned().toPlainDate();
  const datesToLoad = [todayJst];
  if (isAfternoonJst()) {
    datesToLoad.push(todayJst.add({ days: 1 }));
  }

  await Promise.all(datesToLoad.map((date) => loadPermutationImageForDate(date)));

  if (imageCache.has(todayJst.toString()) && !animating) {
    items = buildItems(currentBase);
    renderItems(items, CENTER_INDEX);
  }
}

function permutationsFor(localZoned: Temporal.ZonedDateTime): ExtractedPermutations {
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

function createItem(localZoned: Temporal.ZonedDateTime): ClockItem {
  const { leftPermutation, rightPermutation } = permutationsFor(localZoned);
  return {
    time: formatTime(localZoned),
    leftPermutation,
    rightPermutation,
  };
}

function buildItems(baseZoned: Temporal.ZonedDateTime): ClockItem[] {
  const result: ClockItem[] = [];
  for (let i = -ABOVE; i <= BELOW; i += 1) {
    result.push(createItem(zonedAt(baseZoned, i)));
  }
  return result;
}

function advanceItems(previous: ClockItem[], baseZoned: Temporal.ZonedDateTime): ClockItem[] {
  return [...previous.slice(1), createItem(zonedAt(baseZoned, BELOW))];
}

function renderPermutation(permutation: DisplayPermutation): string {
  return permutation
    .map((value) => `<span class="clock__num">${value}</span>`)
    .join("");
}

function renderItems(items: ClockItem[], currentIndex: number): void {
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

function getItemHeight(): number {
  const firstItem = listEl.querySelector(".clock__item");
  return firstItem instanceof HTMLElement ? firstItem.offsetHeight : 56;
}

function resetListPosition(): void {
  listEl.classList.add("clock__list--instant");
  listEl.style.transform = "translateY(0)";
  void listEl.offsetHeight;
  listEl.classList.remove("clock__list--instant");
}

function wallSecond(): Temporal.ZonedDateTime {
  return currentZonedSecond();
}

function isAtOrPastSecond(target: Temporal.ZonedDateTime): boolean {
  return Temporal.ZonedDateTime.compare(wallSecond(), target) >= 0;
}

function clampCurrentBaseToWall(): void {
  const wall = wallSecond();
  if (Temporal.ZonedDateTime.compare(currentBase, wall) <= 0) {
    return;
  }

  currentBase = wall;
  items = buildItems(currentBase);
  renderItems(items, CENTER_INDEX);
  resetListPosition();
}

function snapIfBehind(): void {
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

function commitTick(nextBase: Temporal.ZonedDateTime): void {
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

function finishAnimation(): void {
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

function beginAnimation(nextBase: Temporal.ZonedDateTime, boundaryInstant: Temporal.Instant): void {
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

function runClockTick(): void {
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

function startClockLoop(): void {
  if (tickFrameId !== undefined) {
    return;
  }

  const loop = (): void => {
    tickFrameId = requestAnimationFrame(loop);
    runClockTick();
  };

  tickFrameId = requestAnimationFrame(loop);
}

async function init(): Promise<void> {
  currentBase = currentZonedSecond();
  items = buildItems(currentBase);
  renderItems(items, CENTER_INDEX);
  resetListPosition();
  await loadInitialImages();
  initDayVirtualList();
  startClockLoop();
}

void init();
